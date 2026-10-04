#!/usr/bin/env python
"""Measures, on the REAL legacy candidate point-in-time evidence (Parquet archive), what shared-context normalization (one nested level) and candidate information-value
tiering save per decision. Every number is computed from the archived rows; nothing is estimated from names. Local files only, read only.

usage: python tools/theta-pit-normalization-analysis.py --parquet=<dataset dir> --output=<json> [--finalist-rank=10]
"""
import argparse
import json
from pathlib import Path

import duckdb

OBJECT_COLUMNS = ['contract_json', 'market_json', 'volatility_json', 'technical_json', 'event_json', 'flow_json', 'ownership_json', 'account_json', 'portfolio_json', 'aegis_json',
                  'execution_json', 'known_economics_json']
WHOLE_COLUMNS = ['unknown_economics_json', 'hard_blockers_json', 'soft_evidence_json', 'provider_provenance_json']
REFERENCE_OVERHEAD_BYTES = 48   # a field -> content-hash reference inside a candidate row
ROW_OVERHEAD_BYTES = 300        # scalar columns of a candidate row
HISTOGRAM_BYTES = 600           # compact rejection histogram per decision


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--parquet', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--finalist-rank', type=int, default=10)
    args = parser.parse_args()
    glob = str(Path(args.parquet)).replace('\\', '/') + '/dp_session_date=*/*.parquet'
    con = duckdb.connect()
    json_columns = ', '.join(f'{column}::VARCHAR AS {column}' for column in OBJECT_COLUMNS + WHOLE_COLUMNS)
    hot = f"(selected OR coalesce(rank_at_decision, 999999) <= {args.finalist_rank} OR hard_status NOT IN ('FEASIBLE','HARD_VETO'))"
    con.execute(f"CREATE TABLE pit AS SELECT fusion_snapshot_id, candidate_id, {hot} AS hot, {json_columns} FROM read_parquet('{glob}', hive_partitioning=true)")
    rows, decisions, hot_rows = con.execute('SELECT count(*), count(DISTINCT fusion_snapshot_id), count(*) FILTER (WHERE hot) FROM pit').fetchone()

    selects = []
    children = {}
    for column in OBJECT_COLUMNS:
        keys = [row[0] for row in con.execute(f"SELECT DISTINCT unnest(json_keys({column})) FROM (SELECT {column} FROM pit USING SAMPLE 800 ROWS) WHERE json_valid({column}) AND json_type({column}) = 'OBJECT'").fetchall() if row[0] is not None]
        children[column] = sorted(keys)
        for key in keys:
            safe = key.replace("'", "''")
            selects.append(f"SELECT fusion_snapshot_id, hot, '{column}.{safe}' AS f, md5(x) AS h, length(x) AS len FROM (SELECT fusion_snapshot_id, hot, json_extract_string({column}, '$.\"{safe}\"') AS x FROM pit) WHERE x IS NOT NULL")
        # a child list that is not exhaustive (rare keys) is covered by the whole-object remainder below
        selects.append(f"SELECT fusion_snapshot_id, hot, '{column}.__whole' AS f, md5({column}) AS h, length({column}) AS len FROM pit WHERE {column} IS NOT NULL AND json_type({column}) <> 'OBJECT'")
    for column in WHOLE_COLUMNS:
        selects.append(f"SELECT fusion_snapshot_id, hot, '{column}' AS f, md5({column}) AS h, length({column}) AS len FROM pit WHERE {column} IS NOT NULL")
    con.execute('CREATE TABLE kv AS ' + ' UNION ALL '.join(selects))

    fields = []
    for field, total, normalized, distinct, n in con.execute(
        "WITH g AS (SELECT fusion_snapshot_id, f, h, min(len) AS len, count(*) AS c FROM kv GROUP BY 1, 2, 3) SELECT f, sum(len * c), sum(len), count(*), sum(c) FROM g GROUP BY f ORDER BY sum(len * c) DESC"
    ).fetchall():
        fields.append({'field': field, 'rows': int(n), 'uniqueHashesPerDecisionSum': int(distinct), 'duplicationRatio': round(n / distinct, 2), 'totalBytes': int(total),
                       'normalizedBytes': int(normalized) + REFERENCE_OVERHEAD_BYTES * int(n), 'estimatedSavingBytes': int(total) - int(normalized) - REFERENCE_OVERHEAD_BYTES * int(n)})
    original_per_decision = con.execute(
        f"SELECT round(quantile_cont(b, 0.5)), round(quantile_cont(b, 0.95)), round(avg(b)), max(b), sum(b) FROM (SELECT fusion_snapshot_id, sum(len) + count(DISTINCT f) * 0 AS b FROM kv GROUP BY 1)").fetchone()
    # all rows normalized (no tiering): each distinct (field, hash) once per decision plus a reference per row and field
    normalized_all = con.execute(
        f"WITH d AS (SELECT fusion_snapshot_id, f, h, min(len) AS len FROM kv GROUP BY 1, 2, 3), n AS (SELECT fusion_snapshot_id, sum(len) AS b FROM d GROUP BY 1), "
        f"r AS (SELECT fusion_snapshot_id, count(*) * ({ROW_OVERHEAD_BYTES} + {REFERENCE_OVERHEAD_BYTES} * {len(OBJECT_COLUMNS)}) AS b FROM pit GROUP BY 1) "
        f"SELECT round(quantile_cont(n.b + r.b, 0.5)), round(quantile_cont(n.b + r.b, 0.95)), round(avg(n.b + r.b)), max(n.b + r.b), sum(n.b + r.b) FROM n JOIN r USING (fusion_snapshot_id)").fetchone()
    # tiered: only HOT rows keep detail; distinct values among hot rows once per decision; ordinary rejected rows become a histogram
    tiered = con.execute(
        f"WITH d AS (SELECT fusion_snapshot_id, f, h, min(len) AS len FROM kv WHERE hot GROUP BY 1, 2, 3), n AS (SELECT fusion_snapshot_id, sum(len) AS b FROM d GROUP BY 1), "
        f"r AS (SELECT fusion_snapshot_id, count(*) FILTER (WHERE hot) * ({ROW_OVERHEAD_BYTES} + {REFERENCE_OVERHEAD_BYTES} * {len(OBJECT_COLUMNS)}) + {HISTOGRAM_BYTES} AS b FROM pit GROUP BY 1) "
        f"SELECT round(quantile_cont(coalesce(n.b, 0) + r.b, 0.5)), round(quantile_cont(coalesce(n.b, 0) + r.b, 0.95)), round(avg(coalesce(n.b, 0) + r.b)), max(coalesce(n.b, 0) + r.b), sum(coalesce(n.b, 0) + r.b) FROM r LEFT JOIN n USING (fusion_snapshot_id)").fetchone()

    def summary(row):
        return {'p50': int(row[0]), 'p95': int(row[1]), 'mean': int(row[2]), 'max': int(row[3]), 'sum': int(row[4])}

    original = summary(original_per_decision)
    result = {
        'rows': int(rows), 'decisions': int(decisions), 'avgCandidatesPerDecision': round(rows / decisions, 1), 'hotRows': int(hot_rows), 'finalistRank': args.finalist_rank, 'children': children,
        'fields': fields[:40],
        'perDecisionBytes': {'original': original, 'normalizedAllRows': summary(normalized_all), 'normalizedAndTiered': summary(tiered)},
        'reductionPercentMeanNormalizedOnly': round(100 * (1 - normalized_all[2] / original['mean']), 1),
        'reductionPercentMeanNormalizedAndTiered': round(100 * (1 - tiered[2] / original['mean']), 1),
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'decisions': result['decisions'], 'avgCandidates': result['avgCandidatesPerDecision'], 'hotRows': result['hotRows'], 'perDecisionBytes': result['perDecisionBytes'],
                      'reductionNormalizedOnly': result['reductionPercentMeanNormalizedOnly'], 'reductionNormalizedAndTiered': result['reductionPercentMeanNormalizedAndTiered']}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

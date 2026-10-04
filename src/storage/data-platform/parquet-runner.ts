// Runs the Parquet long-term memory commands (bots/theta/quant/research/platform_parquet_cli.py) as a subprocess. Every command prints one JSON line; a non-zero exit, a timeout or an
// unparsable answer is a verification failure, never a pass. The runner is an interface so the automation is testable without Python.
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface ParquetConvertRequest { readonly chunks: readonly string[]; readonly outDir: string; readonly dataset: string; readonly timeColumn: string; readonly keyColumn: string; readonly digest: string; readonly producerSha: string }
export interface ParquetResult { readonly ok: boolean; readonly detail: Readonly<Record<string, unknown>> }

export interface ParquetRunner {
  convert(request: ParquetConvertRequest): Promise<ParquetResult>;
  /** hash every file against its manifest and open the dataset through DuckDB (row count must equal the manifest) */
  verify(manifestPath: string): Promise<ParquetResult>;
  /** read one row from every file */
  openCheck(manifestPath: string): Promise<ParquetResult>;
  compact(datasetDir: string, producerSha: string): Promise<ParquetResult>;
}

export class SubprocessParquetRunner implements ParquetRunner {
  constructor(private readonly python = process.env.THETA_PYTHON_EXECUTABLE ?? (process.platform === 'win32' ? 'python' : 'python3'), private readonly quantRoot = resolve('bots/theta/quant'), private readonly timeoutMs = 20 * 60_000) {}
  private run(args: readonly string[]): Promise<ParquetResult> {
    return new Promise((done) => {
      execFile(this.python, ['-m', 'research.platform_parquet_cli', ...args], { cwd: this.quantRoot, timeout: this.timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
        const lastLine = String(stdout).trim().split('\n').at(-1) ?? '';
        try { const parsed = JSON.parse(lastLine) as Record<string, unknown>; done({ ok: error === null && parsed.ok === true, detail: parsed }); }
        catch { done({ ok: false, detail: { error: error === null ? 'PARQUET_CLI_UNPARSABLE_OUTPUT' : `PARQUET_CLI_FAILED:${error.message.slice(0, 160)}` } }); }
      });
    });
  }
  convert(request: ParquetConvertRequest): Promise<ParquetResult> {
    return this.run(['convert', '--chunks', request.chunks.join(','), '--out', request.outDir, '--dataset', request.dataset, '--time-column', request.timeColumn, '--key-column', request.keyColumn, '--digest', request.digest, '--producer-sha', request.producerSha]);
  }
  verify(manifestPath: string): Promise<ParquetResult> { return this.run(['verify', '--manifest', manifestPath]); }
  openCheck(manifestPath: string): Promise<ParquetResult> { return this.run(['open-check', '--manifest', manifestPath]); }
  compact(datasetDir: string, producerSha: string): Promise<ParquetResult> { return this.run(['compact', '--dataset-dir', datasetDir, '--producer-sha', producerSha]); }
}

/** a runner that records calls and answers with scripted results (tests) */
export class ScriptedParquetRunner implements ParquetRunner {
  readonly calls: string[] = [];
  constructor(private readonly answers: Partial<Record<'convert' | 'verify' | 'openCheck' | 'compact', ParquetResult>> = {}) {}
  /** like the real converter it leaves a dp_session_date partition directory with a part file and parquet-manifest.json behind (placeholder bytes), so the automation upload step is exercised */
  private answer(name: 'convert' | 'verify' | 'openCheck' | 'compact'): Promise<ParquetResult> { this.calls.push(name); return Promise.resolve(this.answers[name] ?? { ok: true, detail: { scripted: true } }); }
  async convert(request: ParquetConvertRequest): Promise<ParquetResult> {
    const answer = await this.answer('convert');
    if (answer.ok) { const directory = join(request.outDir, request.dataset, 'dp_session_date=scripted'); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, 'part-0.parquet'), `PAR1-scripted-${request.digest}`); writeFileSync(join(request.outDir, request.dataset, 'parquet-manifest.json'), JSON.stringify({ rowCount: 1, scripted: true })); }
    return answer;
  }
  verify(): Promise<ParquetResult> { return this.answer('verify'); }
  openCheck(): Promise<ParquetResult> { return this.answer('openCheck'); }
  compact(): Promise<ParquetResult> { return this.answer('compact'); }
}

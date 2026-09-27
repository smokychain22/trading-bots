import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.expiration_outcome import ExpirationEvidenceInput, ExpirationOutcomeState, resolve_expiration_outcome


def evidence(**overrides):
    base = dict(option_symbol='SPY261016P00650000', closed_before_expiry_observed=None,
        contract_has_matured=True, itm_at_expiration_observed=None,
        broker_assignment_event_observed=None, broker_exercise_event_observed=None)
    base.update(overrides)
    return ExpirationEvidenceInput(**base)


class ExpirationOutcomeTests(unittest.TestCase):
    def test_closed_before_expiry_takes_priority(self):
        result = resolve_expiration_outcome(evidence(closed_before_expiry_observed=True, itm_at_expiration_observed=True))
        self.assertEqual(result.state, ExpirationOutcomeState.CLOSED_BEFORE_EXPIRY)

    def test_unmatured_contract_is_censored(self):
        result = resolve_expiration_outcome(evidence(contract_has_matured=False))
        self.assertEqual(result.state, ExpirationOutcomeState.CENSORED)

    def test_exercise_evidence_wins_over_assignment(self):
        result = resolve_expiration_outcome(evidence(broker_exercise_event_observed=True, broker_assignment_event_observed=True))
        self.assertEqual(result.state, ExpirationOutcomeState.EXERCISED)

    def test_assignment_evidence(self):
        result = resolve_expiration_outcome(evidence(broker_assignment_event_observed=True))
        self.assertEqual(result.state, ExpirationOutcomeState.ASSIGNED)

    def test_otm_at_expiration_with_no_other_evidence(self):
        result = resolve_expiration_outcome(evidence(itm_at_expiration_observed=False))
        self.assertEqual(result.state, ExpirationOutcomeState.EXPIRED_OTM)

    def test_itm_alone_never_infers_assignment(self):
        result = resolve_expiration_outcome(evidence(itm_at_expiration_observed=True))
        self.assertEqual(result.state, ExpirationOutcomeState.EXPIRED_ITM_NO_ASSIGNMENT_EVIDENCE)
        self.assertIn('broker_assignment_event_observed', result.future_identifiable_fields)

    def test_no_evidence_at_all_matured_contract_is_unknown(self):
        result = resolve_expiration_outcome(evidence())
        self.assertEqual(result.state, ExpirationOutcomeState.UNKNOWN)

    def test_moneyness_field_does_not_exist_on_input(self):
        field_names = ExpirationEvidenceInput.__dataclass_fields__.keys()
        self.assertNotIn('moneyness', field_names)
        self.assertNotIn('strike', field_names)


if __name__ == '__main__':
    unittest.main()

import sys

sys.stdin.read()
# Deliberately non-standard JSON tokens -- Python's json module emits these
# for float('nan')/float('inf') unless allow_nan=False is set. JS's
# JSON.parse rejects them, which is exactly the MALFORMED_JSON path this
# fixture exists to exercise.
print('{"policyVersion": "v1", "value": NaN}')

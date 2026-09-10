import json
import sys

payload = json.loads(sys.stdin.read())
print(json.dumps({
    "policyVersion": "v1",
    "fusionSnapshotHash": payload.get("fusionSnapshotHash", "unknown"),
    "modelVersions": {"ownership": "v1"},
    "echoed": payload,
}))

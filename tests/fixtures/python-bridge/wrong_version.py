import json
import sys

payload = json.loads(sys.stdin.read())
print(json.dumps({
    "policyVersion": "v-wrong",
    "fusionSnapshotHash": payload.get("fusionSnapshotHash", "unknown"),
    "modelVersions": {"ownership": "v-wrong"},
}))

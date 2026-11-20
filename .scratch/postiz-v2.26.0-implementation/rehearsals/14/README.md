# Ticket 14 rehearsal — final image on a v2.25.3 database

This directory is a copy of ticket 10's rehearsal on the integration tip, renamed
from `t10-*` to `t14-*` so it can run independently without overwriting ticket 10's
committed evidence. The assertions, seeds, schema and SQL are unchanged.

```bash
export PATH="$HOME/.local/share/postiz-toolchain/node-v22.23.4-darwin-arm64/bin:$PATH"
./k8s/prepare-build-context.sh
./k8s/build-local.sh --tag postiz-ticket14:<sha>
cd .scratch/postiz-v2.26.0-implementation/rehearsals/14
IMAGE=postiz-ticket14:<sha> ./run-rehearsal.sh
```

The run creates an isolated PostgreSQL 15, Redis, Temporal auto-setup server,
the candidate container and a named uploads volume, then removes them. It leaves
the per-assertion result in `evidence/summary.txt`.

Result on the final candidate (`b5967374`, image
`postiz-ticket14:b596737423c7`): **74 PASS / 0 FAIL / 1 UNVERIFIED**. The one
unverified item is the inactive `k8s/Dockerfile.runtime`, which needs prebuilt
artifacts this repository does not produce; the deployment image
(`k8s/Dockerfile`) passed.

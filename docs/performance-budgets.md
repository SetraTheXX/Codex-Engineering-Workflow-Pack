# CEWP-Controlled Performance Budgets

These budgets exclude model execution, network latency, repository test commands, and
host queue time. They are regression ceilings for CEWP-owned processing on a supported
local machine, not user-facing speed guarantees.

| Operation | Candidate ceiling |
| --- | ---: |
| Doctor JSON | 2,000 ms |
| Workflow plan validation | 1,000 ms |
| Run status/progress rendering | 1,000 ms |
| Checkpoint verification bookkeeping, excluding the command | 1,000 ms |
| Local package install/uninstall fixture | 30,000 ms |
| Large-run receipt/inspection fixture | 3,000 ms |

Release evidence records OS, Node, Git, package version, fixture size, repetitions,
median, upper quantile, and maximum. Model-operation counts, available usage
categories, estimate error, repair operations, verification runs, and log volume are
reported separately in receipts/pilot reports. Estimator confidence requires the
minimum sample and current drift checks; pricing snapshots are dated inputs and are
never inferred from unavailable host usage.

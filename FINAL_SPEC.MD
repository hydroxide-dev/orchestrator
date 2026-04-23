Hydroxide is a self-hosted cloud control plane for running services on Proxmox VE.

This page pulls the scattered concept notes into one buildable spec. The target is simple: declare service intent in YAML, place it on a node, keep reconciling, and expose the result through the UI, CLI, SSH, and automation.

Hydroxide should feel like one platform even as more nodes are added for compute capacity and high availability. The user should think in terms of services and outcomes, not manual VM babysitting.

## Product Shape
- service-first, not VM-first
- one logical platform across many nodes
- desired state and actual state stay separate
- failures are explicit and actionable
- reconciliation is continuous, not a one-time task
- the first release should be buildable with a small, opinionated scope

## Repository Boundaries
Hydroxide should stay intentionally small at the repository level:
- [`hydroxide-dev/orchestrator`](https://github.com/hydroxide-dev/orchestrator) - currently empty; future control plane runtime, API surface, and reconciliation engine
- [`hydroxide-dev/image`](https://github.com/hydroxide-dev/image) - curated image catalog, verification metadata, and import targets
- [`hydroxide-dev/.github`](https://github.com/hydroxide-dev/.github) - organization-level GitHub config, shared workflows, and repo hygiene

No other repositories are required for the v1 shape of the platform.

## Core Contract
Users author two YAML files:
- `compute.yaml` - infrastructure and runtime requirements
- `service.yaml` - service identity, provisioning, and health behavior

The orchestrator compiles those files into one internal desired-state model. After parse time, Hydroxide should stop thinking in terms of two disconnected files and start thinking in terms of one service intent with runtime requirements.

## Canonical Objects
The platform should treat these as first-class objects:
- `Service` - the user-facing thing that should exist
- `Instance` - one runtime realization of a service
- `Node` - a schedulable machine with capacity, capabilities, and health state
- `Image` - a base runtime image and its availability state
- `NetworkAttachment` - how a workload is attached, addressed, and exposed
- `DiskAttachment` - what storage it needs, where it lives, and whether it is persistent
- `Capability` - GPU, vGPU, SR-IOV, USB passthrough, and similar hardware/runtime features
- `Operation` - a tracked orchestration action with status, retries, actor, and outcome
- `Condition` / `Status` - human-readable state for UI and CLI

## Control Loop
The orchestrator should behave like a control loop, not a pile of one-off tasks:
1. Accept `compute.yaml` and `service.yaml`.
2. Validate the spec and policy.
3. Compile the desired service model.
4. Resolve placement.
5. Provision the instance and attach runtime pieces.
6. Run provisioning or startup hooks.
7. Wait for readiness and health.
8. Publish status.
9. Keep reconciling.

A successful create action only starts the lifecycle. Reconciliation is what keeps the service correct over time.

## Placement and Scheduling
Scheduling is where Hydroxide stops feeling like a VM helper and starts feeling like a platform.

Placement should account for:
- CPU and RAM availability
- storage classes and storage pressure
- bridge and network availability
- GPU, vGPU, SR-IOV, USB passthrough, and similar capability inventory
- node health, heartbeat, and maintenance state
- policy constraints such as exposure rules or restricted hardware

The scheduler should produce one of two outcomes:
- a valid placement
- a specific reason placement is blocked

Useful placement output should include:
- selected node
- attachment targets for storage and networking
- any required capabilities
- blocked or degraded reasons when placement is not possible

Rules that matter:
- fail before provisioning when placement is impossible
- treat storage as part of scheduling, not cleanup after scheduling
- treat networking as part of scheduling, not a late-stage side quest
- keep placements stable unless there is a real reason to move or recreate
- explain why a service cannot be placed instead of returning a generic error

## Lifecycle and Reconciliation
Hydroxide should expose a small, idempotent set of lifecycle actions:
- `create`
- `start`
- `stop`
- `restart`
- `destroy`
- `recreate`

Those actions should map cleanly to operation records and visible state changes.

Health should drive repair, not just dashboards. Hydroxide should respect startup grace, distinguish transient failure from sustained failure, and apply a clear recovery path such as retry, restart, recreate, or escalate.

Partial failures must remain visible. Examples include:
- VM created but provisioning failed
- network attached but DNS registration failed
- disk created but boot failed
- workload booted but health checks never passed

## Networking and Reachability
Hydroxide should:
- attach workloads to the correct bridge or bridges
- apply declared IP behavior such as DHCP, SLAAC, or static assignment
- manage published ports and reject collisions
- generate and maintain service identity on the network side
- assign or validate hostnames
- maintain DNS registration and endpoint metadata
- expose reachability state for each service

Recommended reachability states:
- `scheduled`
- `booting`
- `healthy-private`
- `healthy-public`
- `degraded`
- `blocked`

The platform should also enforce exposure policy, such as whether a service is private-only or externally reachable.

## Storage
Hydroxide should resolve storage as part of the platform model, not as an afterthought.

The storage classes are:
- `boot`
- `storage-fast`
- `storage-slow`
- `backup`

Hydroxide should:
- resolve requested disk classes to actual storage targets
- provision boot and data disks consistently
- track whether a disk is persistent or disposable
- avoid destructive actions when persistent data is attached
- surface storage pressure and reject placements that would fail later

## Images
Hydroxide should not become an OS image distro.

The image system should separate three things:
- upstream OS artifacts
- Hydroxide's curated image catalog
- local imported templates on the cluster

The `hydroxide-dev/image` repository should act as the source-of-truth catalog for known-good upstream images and their metadata. The catalog should keep stable IDs such as `ubuntu-24.04` or `debian-12` so users choose Hydroxide IDs, not raw upstream artifact names.

A normal image flow should look like this:
1. Hydroxide reads the upstream manifest from `hydroxide-dev/image` or another declared source.
2. Hydroxide matches that image against its local registry in `config/images.json`.
3. The user selects a stable Hydroxide image ID such as `local/endeavouros` or `hydroxide-dev/image/ubuntu-24.04`.
4. Hydroxide resolves the download URL from the manifest or local override.
5. Hydroxide verifies the checksum before import.
6. Hydroxide imports the image into Proxmox at the registered PVE path.
7. Hydroxide turns that imported image into a reusable template.
8. New workloads clone from that template instead of re-importing every time.

Hydroxide should assume Cloud-Init is the standard bootstrap path. It should:
- require Cloud-Init support for first-class images
- inject SSH keys and first-boot config through Cloud-Init
- install and enable `qemu-guest-agent` on first boot when needed

The image catalog should describe things like:
- upstream URL
- checksum
- format such as `qcow2`
- distro family and release
- default username expectation
- whether the image is stable or experimental
- whether Hydroxide should expect first-boot guest-agent bootstrap

## IAM and Safe Execution
Hydroxide should enforce identity consistently across:
- Web UI
- `hydctl`
- SSH
- automation-triggered actions

The identity model should be SSH-key-based with system-level user mapping. Each user should be provisioned as a PAM user with username, password, and SSH key.

Before making changes, the orchestrator must validate whether the effective actor may:
- create or destroy workloads
- target a given node
- use a given image
- expose specific ports
- request special hardware classes such as GPU or vGPU

Every action should record the effective actor for auditability.

## Interfaces
### Web UI
The UI should show:
- desired state
- actual state
- health
- placement
- reachability
- last operation
- failure reason

### CLI
`hydctl` is the command line tool for managing a Hydroxide node. It should work in both local and remote mode and obey the same IAM rules as the Web UI.

### QuickShell
QuickShell should remain a sandboxed, global shell for quick administrative access. It is for the cases where the user needs a tool, not a machine terminal.

## Operations and History
Every meaningful action should become a tracked `Operation` with:
- internal event name
- human-readable name
- unique ID
- actor
- target service or instance
- target node
- status
- timestamps for create, start, finish, and retry
- retry count
- failure reason
- structured config or payload
- whether the operation was user-requested or background reconciliation

That history should power:
- timelines in the UI
- audit trails
- CLI debugging
- background reconciliation visibility

## V1 Non-Goals
To keep v1 focused, the orchestrator should not:
- build a full custom SDN before bridge, IP, DNS, and exposure logic are reliable
- become a full configuration-management system inside guests
- require automatic driver installation as part of basic GPU or vGPU support
- hide raw Proxmox failures behind vague Hydroxide-only errors

## Build Order
A practical implementation sequence is:
1. Parse the two YAML files.
2. Validate spec and policy.
3. Compile one desired-state model.
4. Resolve placement from node inventory.
5. Provision compute, disks, and networking.
6. Run startup and health hooks.
7. Record operations and expose status.
8. Keep reconciling and repairing drift.
9. Add richer image, IAM, and maintenance flows.

If this is implemented correctly, a user can declare a service from YAML, place it on a node, observe it, repair it, and keep it stable over time.

## Acceptance Criteria
A useful v1 should satisfy these scenarios:
- create a service from `compute.yaml` and `service.yaml` and reconcile it from pending to healthy
- reject workloads that exceed available CPU, RAM, or storage
- reject workloads that require vGPU when no node advertises compatible capability
- recover from a failed health check according to the declared policy
- mark services degraded when node heartbeat is lost and take the configured recovery action
- drain a node and safely stop, move, or recreate affected workloads
- surface partial-failure states with explicit reasons
- deny unauthorized UI, CLI, or SSH actions before any mutation occurs
- detect network conflicts such as duplicate published ports
- preserve persistent data across recreate and redeploy actions

## Canonical YAML
### `compute.yaml`
```yaml
version: 1
resources:
  cpu:
    cores: 4
  ram:
    amount: 8192
  disk:
    - id: boot
      type: boot
      size: 16384
    - id: media
      type: storage-slow
      size: 262144
  network:
    ports:
      - 80:80/http
      - 443:443/https
    bridges:
      - name: vmbr0
        ipv4: dhcp
        ipv6: slaac
runtime:
  os: hydroxide-dev/image/ubuntu-24.04
```

### `service.yaml`
```yaml
version: 1
catalog:
  name: jellyfin
  friendly: Jellyfin
  description: Media server
  tags:
    - media
    - video
meta:
  author: hydroxide
  license: MIT
  source: https://github.com/hydroxide-dev/image
provision:
  packages:
    - jellyfin
  hooks:
    install:
      - systemctl enable --now jellyfin
    failed_health:
      - systemctl restart jellyfin
    shutdown:
      - systemctl stop jellyfin
  health:
    type: http
    action: http://{service}:8096/health
    timeout:
      success: 120s
      failed: 60s
```

### Image catalog note
The image catalog stays in `hydroxide-dev/image` and is expected to track stable upstream images rather than custom-baked OS builds. The orchestrator should consume that catalog, verify it, and template it into local cluster artifacts.

## Working Rule
If the system ever starts to feel VM-centric, image-factory-centric, or task-runner-centric, the design has drifted. The right mental model is a service platform that continuously reconciles desired state onto a fleet of nodes.

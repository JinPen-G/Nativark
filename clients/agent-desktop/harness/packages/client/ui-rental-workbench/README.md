---
description: "Choose a Rental OS business workspace and show the existing administration pages beside the local Harness AI workbench."
kind: "package-reference"
---
# @rental-os/dsh-client-ui-rental-workbench

English | [中文](README.zh.md)

## Summary

Choose an authorized business workspace and switch between the local AI workbench and Rental OS administration pages. Business menus come from the existing administration application. Mode changes do not start model requests or submit business forms. Model configuration stays with Harness; this package receives no business credentials.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web application bundle declares this presentation plugin. It registers controls only when the configured Electron main window exposes the owned Rental OS bridge; an ordinary Harness Web client keeps its existing interface.

The desktop deployment selects the original administration application. Credentials remain in that isolated document. Save or finish protected drafts before changing accounts or business workspaces. Reconnection loads the approved document and does not repeat the last command. Configuration and build prerequisites belong to the [Rental OS integration entry](../../../../README.md).

The expanded sidebar also offers a human-only catalog preview. Enter a supported request such as `show catalog` or `show first 5 products`, plus a provider identifier and HTTPS base URL already allowed by the workspace policy. The entire request is parsed locally into a 1–50 row bound (default ten); raw text, personal details and unsupported conditions are never forwarded to the business bridge or a model. Missing, disabled or expired policy, denied access and audit failure prevent disclosure; workspace changes and expiry remove the preview. Names, codes, inventory and prices are omitted. Administrators maintain this policy on the original AI service settings page, with revision CAS and original-key recovery after an ambiguous save. This is not Agent business mode, actual model-destination attestation or authorization to put results into chat history.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin contributes controls to the existing sidebar slots, a keyed business panel, and a shell-owned notice. Electron owns the native business view. The plugin projects view bounds and requests registered navigation, workspace changes or the closed catalog preview. The administration application executes those requests through its original authentication, router, and API. The existing layout retains the previous AI panel while the business view is displayed.

The [client entry](src/client/index.ts) owns subscriptions and reversible registrations. The [presentation](src/client/Workbench.tsx) consumes injected data and callbacks. The [shared protocol](../../../../../../packages/shared/src/agent-desktop.ts) excludes model keys and business credentials.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Rental OS client integration](../../../../README.md)
- [Harness client architecture](../../../docs/subsystems/web-client.md)
- [Slots](../../../docs/subsystems/slots.md)
- [Desktop](../../../apps/desktop/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Desktop presentation

#### What the model sees

Nothing. This package adds no model tools, prompts, business page contents, or session events.

#### Token effect

Zero direct model tokens or model calls. Business login and navigation do not use a model.

#### KV Cache effect

This package does not alter model request prefixes. Harness and the configured model provider continue to own request construction and cache availability.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

The integration keeps native-host and business-service verification separate from isolated source tests.

- Electron rendering, upload and download dialogs, printing, and the real business login still require authorized native-host verification. Isolated tests are not formal acceptance.
- Public protocol artifacts must be built before Harness type checking or bundling. The projects retain independent dependencies; an installed local environment does not replace native login and page acceptance.
- The package does not grant Agent access to business APIs or page DOM and does not add platform model accounting or server collaboration.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No release or production-readiness claim is made. The project development record owns current verification evidence.

</details>

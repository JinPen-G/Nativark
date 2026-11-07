# Settings workspace

Designed after inspecting the public UIArc Settings page on 2026-11-08:
https://uiarc.dev/components/blocks/settings-page

The reference's task pattern is section navigation, retained form state and clear save feedback.
This adapter supplies the section navigation; existing UIArc Inputs, RadioCards, sliders,
switches and SaveButton retain their source behaviors. It is a local business implementation,
not protected Pro TSX.

`SettingsWorkspace` accepts explicit sections. `SettingsGroups` preserves existing titled
groups and field definitions. Panels stay mounted while hidden so validation and draft state
survive navigation. A new validation error reveals the owning panel, including validation
started by SaveButton. Each existing form/API owns saving and revision checks.

`ADMIN_SETTINGS_METRICS` and the shared typography/neutral tone tokens own geometry and theme.
It is used by appearance, client channels and business-rule draft editing. It never enables
providers, uploads files, publishes configuration or executes business actions automatically.

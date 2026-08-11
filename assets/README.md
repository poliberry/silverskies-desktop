Drop the two logo files here, exactly named:

- `icon-light.png` — light background version (for light-themed Windows taskbars)
- `icon-dark.png` — dark background version (for dark-themed Windows taskbars)

512×512 (or any square size ≥256×256) PNG, no transparency required either way
since both already have their own solid background.

These are loaded at runtime (`electron/main.ts`) to set the window/taskbar icon,
switching automatically with `nativeTheme` — and `icon-dark.png` doubles as the
static icon baked into the installer/exe (`build.win.icon` in package.json).

Nothing else in this repo can generate these for you — Claude can't extract
raw bytes from a pasted chat image, so they need to land here directly.

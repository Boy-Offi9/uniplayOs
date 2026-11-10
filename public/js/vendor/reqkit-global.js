// Exposes the vendored reqkit bundle to the classic scripts as window.reqkit.
// Optional: everything that uses it must keep working when it is missing.
import * as reqkit from './reqkit.mjs';
window.reqkit = reqkit;

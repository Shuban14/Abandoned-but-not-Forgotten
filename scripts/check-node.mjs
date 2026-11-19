// Fails fast with an actionable message when the runtime is too old.
//
// The app targets Node 24 (`.nvmrc`, and `engines: { node: "24.x" }`), which is
// also what CI and Vercel run. The floor below only guards against an ancient
// runtime; nothing here needs `node:sqlite` any more — that module is used only
// by the one-off legacy export script.
const MIN = [22, 5, 0]

const current = process.versions.node.split('.').map(Number)
const [needMajor, needMinor] = MIN
const [major, minor] = current

const ok = major > needMajor || (major === needMajor && minor >= needMinor)

if (!ok) {
  console.error(`
  Space Relics needs Node.js ${MIN.join('.')} or newer (found ${process.versions.node}).

  .nvmrc pins Node 24; CI and Vercel use the same 24.x range.

  Fix:
    nvm install 24 && nvm use 24      # or: nvm use   (reads .nvmrc)
    npm install
`)
  process.exit(1)
}

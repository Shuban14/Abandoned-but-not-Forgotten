// Fails fast with an actionable message when the runtime is too old.
// `node:sqlite` (used for the mission database) only exists from Node 22.5.
const MIN = [22, 5, 0]

const current = process.versions.node.split('.').map(Number)
const [needMajor, needMinor] = MIN
const [major, minor] = current

const ok =
  major > needMajor || (major === needMajor && minor >= needMinor)

if (!ok) {
  console.error(`
  Space Relics needs Node.js ${MIN.join('.')} or newer (found ${process.versions.node}).

  The mission database uses node:sqlite, which is built into Node 22.5+.
  On older versions the API routes crash with "Cannot find module 'node:sqlite'".

  Fix:
    nvm install 22 && nvm use 22      # or: nvm use   (reads .nvmrc)
    # then reinstall dependencies
    npm install
`)
  process.exit(1)
}

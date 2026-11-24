const fs = require('fs')
const path = require('path')

const packageJsonPath = path.join(__dirname, '..', 'package.json')
const outPath = path.join(__dirname, '..', 'src', 'json', 'licenses.json')

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
const nodeModules = path.join(__dirname, '..', 'node_modules')
const result = []
const bundledAssets = [
  {
    name: 'Pretendard Variable',
    version: '1.3.9',
    license: 'OFL-1.1',
    repository: 'https://github.com/orioncactus/pretendard',
  },
]

for (const [name, declaredVersion] of Object.entries(deps)) {
  const pkgDir = path.join(nodeModules, name)
  let version = declaredVersion
  let license = ''
  let repository = ''
  try {
    const pkgPath = path.join(pkgDir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      license = pkg.license || (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type).join(', ') : '') || '-'
      repository = typeof pkg.repository === 'object' ? pkg.repository?.url : pkg.repository || ''
      version = pkg.version || version
    }
  } catch {
    license = '-'
  }
  result.push({ name, version, license, repository })
}

result.push(...bundledAssets)

result.sort((a, b) => a.name.localeCompare(b.name))

const outDir = path.dirname(outPath)
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8')
console.log('Licenses written to', outPath)

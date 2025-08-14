import fs from 'node:fs'

export default function () {
  const source = fs.existsSync('.env') ? '.env' : '.env.example'
  fs.copyFileSync(source, '.dev.vars')

  return () => {
    fs.rmSync('.dev.vars')
  }
}

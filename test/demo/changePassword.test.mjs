import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { SourceTextModule, SyntheticModule } from 'node:vm'

// Exercise the real route with isolated authentication and persistence dependencies.
async function request (current) {
  let writes = 0
  const hash = value => `hashed:${value}`
  const user = { id: 1, password: hash('original'), update: async () => { writes++ } }
  const dependencies = {
    express: {},
    '../lib/challengeUtils': { solveIf: () => {} },
    '../data/datacache': { challenges: {} },
    '../models/user': { UserModel: { findByPk: async () => user } },
    '../lib/insecurity': {
      hash,
      authenticatedUsers: { get: () => ({ data: { id: 1, password: user.password } }) }
    }
  }
  const route = new SourceTextModule(stripTypeScriptTypes(
    readFileSync(new URL('../../routes/changePassword.ts', import.meta.url), 'utf8')
  ))
  await route.link(specifier => {
    const exports = dependencies[specifier]
    assert.ok(exports, `Unexpected dependency: ${specifier}`)
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    })
  })
  await route.evaluate()
  const response = {
    statusCode: 200,
    __: message => message,
    status (code) { this.statusCode = code; return this },
    send (message) { this.message = message },
    json () {}
  }
  await route.namespace.changePassword()({
    query: { current, new: 'replacement', repeat: 'replacement' },
    headers: { authorization: 'Bearer=demo-token' },
    connection: {}
  }, response, error => { throw error })
  return { response, writes }
}

for (const current of [undefined, '', 'incorrect']) {
  test(`rejects ${JSON.stringify(current)} current password without writing`, async () => {
    const { response, writes } = await request(current)
    assert.equal(response.statusCode, 401)
    assert.equal(response.message, 'Current password is not correct.')
    assert.equal(writes, 0)
  })
}

test('accepts the correct current password and updates once', async () => {
  const { response, writes } = await request('original')
  assert.equal(response.statusCode, 200)
  assert.equal(writes, 1)
})

# Integration Test Fixtures

llmock fixture files that produce specific OpenCode event sequences for integration testing.

## Format

Each file uses the `@copilotkit/llmock` JSON fixture format:

```json
{
  "fixtures": [
    {
      "match": { "userMessage": "<substring to match>" },
      "response": { "content": "<text>" }
    }
  ]
}
```

Responses can be text, tool calls, or errors:

```json
{ "response": { "toolCalls": [{ "name": "<tool>", "arguments": "<json string>" }] } }
{ "response": { "error": { "message": "...", "type": "..." }, "status": 429 } }
```

## Fixtures

| File | Trigger Message | Expected Events | Behavior |
|------|----------------|-----------------|----------|
| `simple-completion.json` | `pulse-test-simple` | session.created, session.status(busy), session.status(idle) | Clean exit |
| `tool-use-bash.json` | `pulse-test-bash` | session.status(busy), tool execution (pending/running/completed) | Loops until killed |
| `tool-use-write.json` | `pulse-test-write` | session.status(busy), tool execution | Loops until killed |
| `error-response.json` | `pulse-test-error` | session.error (400), session.idle | Clean exit |
| `rate-limit-429.json` | `pulse-test-ratelimit` | session.status(retry) with exponential backoff | Retries until killed |
| `todo-update.json` | `pulse-test-todo` | todo.updated (total=3, done=1) | Loops until killed |
| `multi-step.json` | `pulse-test-multistep` | session.status(busy), tool execution | Loops until killed |

## Key Behaviors

### Tool-use fixtures loop

llmock matches `userMessage` against the last user text in the conversation history.
After a tool executes, the original user message remains in history, so the same
fixture matches again. Integration tests should: send the message, wait for the
expected event, then kill the OpenCode process.

### Error fixtures are clean

- HTTP 400 (invalid_request_error) produces `session.error` then `session.idle`
- HTTP 429 (rate_limit_error) produces `session.status(retry)` with exponential backoff
- HTTP 500 (server_error) also produces `session.status(retry)`, NOT `session.error`

### Permission events require non-auto-approve mode

With `OPENCODE_PERMISSION='{"*":"allow"}'`, tools execute without
`permission.asked`/`permission.replied` events. To test permission events,
omit this env var and approve permissions via the REST API.

### ANTHROPIC_BASE_URL must include /v1

Set `ANTHROPIC_BASE_URL=http://host:port/v1` (not just `http://host:port`).

## OpenCode Tool Names (v1.2.26)

Discovered via llmock journal. Actual function names registered with the Anthropic API:

`bash`, `read`, `write`, `edit`, `glob`, `grep`, `task`, `webfetch`, `todowrite`, `skill`

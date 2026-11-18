# LangSmith monitoring

The backend exports each `/chat` run as one `underwriting-triage` trace. Its
UUID matches the SSE `run_id` and checkpoint `thread_id`. LangGraph node spans
contain state inputs/outputs and the final memo; native SDK wrappers attach
Gemini drafts and OpenAI critiques, including usage returned by the providers.
Submission loading, SAFER, loss calculations, XGBoost, comparables and hybrid
retrieval have their own spans. The critique loop remains visible as repeated
node/model calls. Model errors remain errors in the trace.

## Configuration

Copy the optional LangSmith section from `.env.example` into the private
repository-root `.env`. Set `LANGSMITH_TRACING=true`, a service key, the correct
regional `LANGSMITH_ENDPOINT`, and `LANGSMITH_WORKSPACE_ID`. Keep the key out of
frontend environment variables and source control.

For a project-based workspace, set `LANGSMITH_PROJECT` to the project name.
For an agent-based workspace, register an **external agent once**, then read
that agent's environments. Set `LANGSMITH_PROJECT` to the selected environment's
**returned `tracer_session_name`**. Do not invent another project or derive the
name from the display name. This is LangSmith's documented compatibility route
for project-name integrations and the locked Python SDK 0.7.37. Native agent
addressing requires a newer SDK; this application uses the compatibility route
and does not combine it with `LANGSMITH_AGENT_ID` variables.

Use `APP_ENVIRONMENT=local` locally and `APP_ENVIRONMENT=production` on Cloud Run.
Choose the corresponding LangSmith environment destination separately. The
workspace, project and client are passed explicitly so `.env` settings work
without exporting them to the shell. Tracing is disabled without both the
enable flag and key. `/diag` reports configuration presence, not proof of trace
delivery. Export buffers are flushed at request completion and shutdown.

## Cloud Run

Store the key in Secret Manager as `langsmith-api-key`, with the runtime service
account granted secret access. Mount it as `LANGSMITH_API_KEY`. Set these
nonsecret service variables with `gcloud run services update`:

```text
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_WORKSPACE_ID=<your-workspace-id>
LANGSMITH_PROJECT=<production-environment-tracer-session-name>
APP_ENVIRONMENT=production
```

`cloudbuild.yaml` updates its application settings and secrets, preserving this
optional monitoring configuration on subsequent deployments. It does not
require a LangSmith secret for installations without monitoring.

## Verification and data

Run a synthetic submission with OpenAI critique. In LangSmith, choose the
agent's **Production** environment, open the matching run UUID and check for
the Gemini draft, OpenAI critique, tool/retrieval spans, timings, inputs and
outputs. A bounded repair may produce two drafts and two reviews. The trace
records the actual outcome, including a memo that still needs review.

Tracing sends submission state, model prompts, retrieved evidence and memo
outputs to the configured LangSmith workspace. The current demo uses synthetic
submission packets. Provider and monitoring keys are never model-call inputs.
Unit tests disable external tracing and verify parentage, usage and credential
exclusion through local mock transports.

References: [LangGraph tracing](https://docs.langchain.com/langsmith/trace-with-langgraph),
[agent registration and compatibility configuration](https://docs.langchain.com/langsmith/create-an-agent),
[API key types](https://docs.langchain.com/langsmith/create-account-api-key).

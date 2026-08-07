# Restore a saved recruiting-site login

Use this Agent-side procedure only when a direct chat explicitly asks to use a
saved Cookie login for one provider. Do not use it for the Panel's **Login and
save** or **Restore and verify** actions: those operations run entirely in the
CodeShell Host before the Agent verification task starts.

1. Keep the run scoped to the one provider from the verification payload.
2. Invoke `UseCredential` **without `id`** to obtain the masked credential
   list. This list may expose only `id`, label, and type.
3. Keep only credentials with `type: "cookie"`, then match the provider using
   the credential id, label, and stored platform/domain metadata visible to the
   tool:

   | Provider | Match tokens |
   | --- | --- |
   | BOSS 直聘 | `zhipin`, `boss`, `zhipin.com` |
   | LinkedIn | `linkedin`, `linkedin.com` |
   | 拉勾 | `lagou`, `lagou.com` |
   | 猎聘 | `liepin`, `liepin.com` |
   | 脉脉 | `maimai`, `maimai.cn` |
   | 前程无忧 | `51job`, `51job.com` |
   | 智联招聘 | `zhaopin`, `zhaopin.com` |

4. Inject only when exactly one matching Cookie credential is available. If
   none match, keep `login_required` and say that no saved login was found. If
   several match, do not guess an account; keep `login_required` and ask the
   user to choose a credential label.
5. Invoke `InjectCredential` with that credential id and a provider-specific
   purpose. Treat the host approval or denial as authoritative. Never bypass
   the approval gate.
6. After a successful injection, navigate to the provider again, wait for the
   page, and observe fresh visible state. An injected Cookie count proves only
   that browser storage changed; it does **not** prove that the account is
   authenticated. Classify login only from the rendered page.
7. Invoke `save_channel_verification` after the final observation. When the
   Panel supplied a Trace ID, pass it and then invoke
   `complete_execution_trace`. Claim a write or completed Trace in the final
   answer only after the corresponding Panel tool returned success.

Never invoke `UseCredential` with a Cookie credential id in this workflow:
that materializes a `cookies.txt` file for out-of-browser HTTP clients. Never
read Cookie values, return a Cookie file path, use shell or `curl`, inspect the
browser profile, or replay an authenticated request outside the connected
CodeShell browser.

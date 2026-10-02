# Changelog

## 0.1.1 (2026-10-02)

* Fixed: in an installed app, clicking a navigation item (Memory, Escalations, Audit log, Settings,
  Documentation) loaded a blank page. Navigation now stays inside the app.
* Sharing reads the organization's members from Cribl.Cloud; the chat list is slimmer; reply tables
  no longer squeeze narrow columns.

## 0.1.0 (2026-10-02)

First preview.

* Chat with Vizzy inside Cribl: streaming replies, saved conversations, suggested questions and
  suggested next questions.
* Vizzy's Cribl API calls are made by the signed-in person's browser, with their own Cribl
  permissions. The Vizzy server holds no Cribl credentials.
* Changes need an approval: the exact request is shown, and it is sent to Cribl only after
  Approve is pressed on that card.
* Shared conversations with colleagues in the same Cribl organization.
* Splunk, when VisiCore has connected it for the organization.
* Memory page, escalations to a VisiCore engineer, and an audit log with token usage.
* Settings: licence key, allow changes, the organization's own Anthropic key.

Known limits: this build talks to the prototype Vizzy server (`3-16-140-226.sslip.io`); the
browser tab has to stay open while Vizzy works.

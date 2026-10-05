# Changelog

## 0.1.3 (2026-10-05)

* Settings shows the organization's managed credit when VisiCore has set a limit on it: how much is
  used, and what to do when it is used up (add your own Anthropic key, or ask VisiCore for more).
  Organizations with no limit see nothing new.
* README: a recording of install and first-time setup, install steps that match what Cribl shows,
  and the Enterprise plan requirement.

## 0.1.2 (2026-10-05)

* Settings: connect your own Splunk and Splunk Cloud. The address and a token (or a username and
  password) are entered in the app, tested from the Vizzy server straight away, and can be changed
  or removed there. Each connection has its own "Allow changes, with approval" switch.
* The Cribl card in Settings says how Cribl is reached (each person's own sign-in) and holds the
  switch that used to sit under Changes.
* Needs a Vizzy server that keeps connections for the app; with an older one the Splunk cards are
  left out and everything else works as before.

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

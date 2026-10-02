import { Card, Text } from '@capra/core';
import { Page } from '../components/Page';

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'How Vizzy reaches your Cribl',
    body: [
      'Vizzy thinks on the Vizzy server and acts through this browser tab. When it needs something from Cribl, the app makes that API call here, signed in as you. Vizzy can see and do exactly what you can in Cribl, and nothing more.',
      'The Vizzy server never holds a Cribl credential. Because the calls are made by your tab, the tab has to stay open while Vizzy works; if you close it, the step in progress fails and the conversation is saved.',
    ],
  },
  {
    title: 'Splunk',
    body: [
      'If VisiCore has connected your Splunk to your organization, Vizzy can work in it from here too. Splunk is reached differently from Cribl: the Vizzy server calls it with the connection VisiCore set up, the same for everyone who uses this app, not with your own Splunk sign-in.',
      'Changes in Splunk follow the same rule as in Cribl: Vizzy shows the exact request and waits for an approval. Whether Splunk changes are allowed at all is set on the connection by VisiCore.',
    ],
  },
  {
    title: 'Changes and approvals',
    body: [
      'Vizzy is read-only until "Allow changes, with approval" is switched on in Settings. Even then, nothing is changed without you: Vizzy shows the exact request it wants to send (the method, the address and the body) and waits.',
      'The app itself enforces this. A request that changes anything is sent to Cribl only if you pressed Approve on a card showing that same request in this browser. Secrets in a request are hidden on the card and in the audit log.',
      'Changes in Cribl are staged. Committing and deploying are separate changes with their own approvals.',
    ],
  },
  {
    title: 'What is recorded',
    body: [
      'Every tool call is written to the audit log on the Vizzy server as it finishes: who asked, what it was for, the input with secrets removed, whether it was approved and by whom, and how it went. The log cannot be edited or deleted, by you or by VisiCore.',
      'Conversations are stored on the Vizzy server and are visible only to the person who started them. Deleting a conversation does not remove its audit records.',
    ],
  },
  {
    title: 'Memory',
    body: [
      'Vizzy carries two kinds of notes from one conversation to the next: your preferences, which only you see and which it saves only after asking you, and what it has learned about your environment, which everyone in your organization shares. Both are on the Memory page, where you can correct or remove them.',
    ],
  },
  {
    title: 'Models and billing',
    body: [
      "By default conversations run on VisiCore's managed credits and Vizzy's default model. If your organization adds its own Anthropic API key in Settings, conversations run on that key, Anthropic bills your account, and you can choose the model and effort for each conversation.",
    ],
  },
  {
    title: 'Getting help',
    body: [
      'Use "Ask an engineer" in a conversation to hand it to VisiCore: an engineer reads it and replies there. Vizzy also does this itself when it is stuck or when the work needs a person. To change your licence, contact your VisiCore team.',
    ],
  },
];

export function DocsPage() {
  return (
    <Page open title="Documentation" description="How Vizzy works inside Cribl.">
      {SECTIONS.map((section) => (
        <div key={section.title} className="span-8">
          <Card>
            <Card.Header>
              <Card.Title>{section.title}</Card.Title>
            </Card.Header>
            <Card.Content>
              <div className="prose">
                {section.body.map((paragraph) => <Text as="p" key={paragraph}>{paragraph}</Text>)}
              </div>
            </Card.Content>
          </Card>
        </div>
      ))}
    </Page>
  );
}

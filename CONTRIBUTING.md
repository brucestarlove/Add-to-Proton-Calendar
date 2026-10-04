# Contributing

Use Node.js 22 or newer. There are no npm dependencies to install and no build step.

```sh
npm test
npm run check
npm run package
```

Keep pull requests focused on one problem. Describe the behavior before and after the change and how you verified it. Date detection changes should include a sanitized example and a regression test: a row in the formats table (or the all-day formats table) in `tests/capture.test.js` for page text, or a case in `tests/structured.test.js` for published event data and calendar links. Include an example that should *not* be detected when your change could cause false matches. Changes to the paste helper should cover invalid input and ordinary pastes as well as successful filling.

Maintain the local processing model and explain any proposed permission or network changes. Use `textContent` and native form values for untrusted text. Never inject page text as HTML or save an event automatically. Detection assumptions belong in the review step.

Load the repository as an unpacked extension, reload it after edits, and reload Proton Calendar to refresh its content script. Check the quick event popover and full editor with synthetic event data. Confirm all fields and time zones before saving; you can verify filling without saving. Unit tests simulate Proton's inputs and cannot establish compatibility with its live interface.

Do not include account tokens, private meeting links, message bodies, or real calendar screenshots in issues or tests. Report security vulnerabilities using [SECURITY.md](SECURITY.md).

# Privacy policy for Add to Proton Calendar

Effective date: October 17, 2026. Applies to version 0.3.0.

Add to Proton Calendar is an independent browser extension developed and published by **[Bruce Starlove](https://github.com/brucestarlove)**. It helps you turn event details from a web page or manual entry into a Proton Calendar event form. It is not affiliated with or endorsed by Proton.

## In short

Pages and emails can be personal, so Add to Proton Calendar is designed to keep what it reads with you.

- **Everything happens on your computer.** The extension reads a page only when you click **Find an event on this page**, and works out the event inside your browser.
- **Nothing is sent anywhere.** The extension makes no network requests, so neither the developer nor anyone else receives your page text or event details.
- **Nothing is kept.** There is no account, analytics, tracking, or advertising, and the extension stores nothing. Closing the popup discards its form.
- **You stay in control.** You choose when a page is read, what to copy, where to paste it, and whether to save.

The sections below give the details.

## Data the extension handles

When you click **Find an event on this page**, the extension reads the current tab: any text you have selected, and the rendered text of the page areas most likely to describe an event (the most recently opened dialogs, an open email message, frames from the same site, the main content area, and the whole page), up to 30,000 characters per area. It also reads the addresses of links in those areas, the event data a page publishes for search engines (schema.org JSON-LD or microdata), the page title, and the page's declared language. This content may include website content or personal communications. The current tab's URL is checked to determine whether the page can be read. Your browser's time zone is used as a default.

The extension processes that text locally to suggest an event. It also handles the title, dates, times, time zone, all-day setting, location, and notes you enter or review in the popup. It does not access passwords, cookies, account credentials, or browsing history.

When you choose **Copy event**, these details are written to your system clipboard as plain text. On `calendar.proton.me`, the paste helper examines text from a user paste into the event title field. If it matches the supported event format, the helper fills the open form, including its All day setting, and shows a confirmation or a warning about fields it could not fill. It never saves or submits an event.

## Use, sharing, and network activity

Data is used only to detect, review, copy, and fill event details. The extension has no analytics, advertisements, remote code, or network requests. It does not transmit data to the developer or to a developer-operated service. The developer does not receive the page text or event details.

Pasting places the copied details into Proton's web page. That page can then access those details, and Proton handles saved events under [Proton's privacy policy](https://proton.me/legal/privacy). Other applications can receive the plain text if you paste it elsewhere. Your operating system or clipboard manager may retain or synchronize clipboard contents according to its settings.

Add to Proton Calendar complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. It does not sell user data, use it for advertising, or allow developers to read it through the extension.

## Retention and control

The extension does not persist page text, event details, settings, or identifiers in extension storage. Data is held temporarily while the popup or paste operation runs. Closing the popup discards its form. The copied event remains in your clipboard until replaced; clipboard history may retain older entries independently of the extension. Clear your clipboard and any clipboard history if you want to remove those copies.

You choose when to read a page, copy an event, paste it, and save it. You can disable or uninstall the extension and adjust its site access in your browser's extension settings. Details already pasted into a website or saved in a calendar are controlled by that website.

## Support and updates

For privacy questions, contact Bruce Starlove: [brucestarlove@gmail.com](mailto:brucestarlove@gmail.com). About the publisher: [Bruce Starlove on GitHub](https://github.com/brucestarlove).

You can also use [GitHub Issues](https://github.com/brucestarlove/extension-protoncal/issues), without including private event details. Information you voluntarily submit there is handled by GitHub under [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Support emails are received through Proton Mail. Support messages are voluntarily shared with the maintainer; the extension does not send them automatically. For security reports, see [SECURITY.md](SECURITY.md).

This policy will be updated when the extension's data handling changes. The effective date above identifies the current version.

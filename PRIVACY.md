# Grammafy privacy policy

Effective date: September 13, 2026

Grammafy is a Chrome extension that offers grammar and spelling suggestions in editable fields. It uses Chrome's built-in on-device AI. Grammafy does not operate a proofreading server, require a Grammafy account, include advertising, or use analytics or tracking services.

## Writing and page content

When checking is enabled, Grammafy reads text in supported editable fields to identify possible corrections and display underlines. This can include website content, user-generated content, and personal communications entered into those fields. Grammafy processes that text on the device using Chrome's built-in AI APIs. Grammafy does not send the writing, suggestions, or surrounding page content to the developer or an external proofreading service.

Writing may contain personally identifiable information, such as names or email addresses. Grammafy handles that information only as part of the text being proofread; it does not extract it into a profile or contact list. It observes edits and suggestion interactions to refresh checks and apply or dismiss corrections, and keeps the accepted-suggestion count described below. It does not record a keystroke log or send interaction analytics to the developer.

Grammafy does not check password inputs. It skips fields that are disabled, read-only, marked with `spellcheck="false"`, or explicitly opted out using a supported attribute. Single-line text and search inputs are checked only when that option is enabled.

This policy describes Grammafy. A website into which you type may independently receive or process that writing under its own privacy policy.

## Settings and site information

Grammafy stores whether checking is enabled, whether single-line fields are checked, a list of sites where checking is paused, and a count of accepted suggestions. These settings use `chrome.storage.sync`. If Chrome synchronization is enabled, Chrome may synchronize these preferences, paused-site domains, and the suggestion count through your Google account. Proofread text and correction contents are never written to this synchronized storage by Grammafy.

Grammafy uses the current site's hostname to apply your pause preferences and show the site in the popup. It does not create a browsing-history log.

## Retention and model downloads

Text and correction results may be held temporarily in extension memory to perform checks and avoid repeating a recent check. Grammafy does not persist this proofreading cache to disk. The cache ends when the relevant extension process is terminated or restarted.

Chrome downloads and manages the on-device model, which can require several gigabytes of storage. Model downloads are handled by Chrome; Grammafy does not upload your writing to obtain the model. Chrome and Google manage their own browser services and synchronization under their applicable policies.

## Your controls

You can disable Grammafy globally, pause it on a site, disable single-line checking, dismiss individual suggestions, or remove the extension. Chrome provides controls for synchronization and extension storage. Removing Grammafy removes its local extension storage; any Chrome synchronization data is subject to Chrome's own controls and policies.

## Sharing and limited use

The developer does not receive or sell your writing, personal communications, browsing activity, or stored preferences. Grammafy does not share user data for advertising, profiling, creditworthiness, or lending decisions. Data handled by the extension is used only to provide the proofreading and settings features described here.

Grammafy's use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Contact and changes

For questions, use the [Grammafy support repository](https://github.com/jasonzh0/grammafy/issues). Issues are public, so do not include private writing or sensitive information. Material changes to these practices will be reflected in this policy and its effective date.

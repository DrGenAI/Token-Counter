# Chrome Web Store listing copy

Fill in the bracketed parts before submitting.

## Name (45 char max)

    Token Counter for ChatGPT

## Short description (132 char max)

    See the token count of your ChatGPT conversation and your usage limits, without leaving the page. Export any chat to Markdown.

## Single purpose statement

    Displays token usage information for the ChatGPT conversation the user is
    currently viewing, and exports that conversation to a file.

## Detailed description

    Token Counter adds a small heads-up display to ChatGPT so you always know
    where you stand before you hit a limit, and lets you take a conversation
    with you when you are done.

    WHAT IT SHOWS ON THE PAGE

    Approximate token count for the current conversation, next to the chat
    title, with a bar against your context limit.

    Session and weekly usage bars along the bottom of the message box, read from
    ChatGPT's own data rather than rounded percentages. Bars turn amber past 75
    percent and red past 90 percent, so a limit is obvious before you reach it.
    Each bar carries a pace marker showing how far through the window you are —
    if the fill is ahead of the marker, you are spending faster than the window
    refills.

    An Export action that saves the conversation as a Markdown file.

    HOW IT COUNTS

    Token counts use the same o200k_base byte-pair encoding ChatGPT's models
    use, not a character estimate. Counts follow the active branch of the
    conversation, so edited and regenerated turns are excluded. Counts are
    approximate: they exclude the hidden system prompt, tool definitions and
    attachments, so the real figure is somewhat higher.

    PRIVACY

    No servers, no analytics, no tracking. Everything is computed in your
    browser and nothing leaves your device. The only thing stored is your own
    display settings.

    Not affiliated with, endorsed by, or sponsored by OpenAI. ChatGPT is a
    trademark of OpenAI.

    Source code: https://github.com/DrGenAI/Token-Counter

## Permission justifications

storage
    Saves the user's display preferences: context limit and which elements to
    show. No conversation data is stored.

Host permission — https://chatgpt.com/*
    The extension's entire function is to count and display information about
    the ChatGPT conversation the user is viewing. It must read the page and the
    conversation data the page has already loaded in order to do so. It runs on
    no other site and makes no cross-origin requests.

Remote code
    None. All code, including the tokenizer, is bundled in the package.

## Data usage disclosures

    Personally identifiable information .......... No
    Health information ........................... No
    Financial and payment information ............ No
    Authentication information ................... No (read in memory, never
                                                      collected or transmitted)
    Personal communications ...................... No (conversation text is read
                                                      locally and never sent)
    Location ..................................... No
    Web history .................................. No
    User activity ................................ No
    Website content .............................. No (processed locally only)

    Certifications: does not sell or transfer data to third parties; does not
    use or transfer data for purposes unrelated to the single purpose; does not
    use or transfer data to determine creditworthiness or for lending.

## Assets needed

    Icon             128x128 PNG (included)
    Screenshots      1280x800 or 640x400, at least one, up to five
    Small tile       440x280 PNG (optional but improves placement)
    Privacy policy   a public URL — GitHub Pages is fine

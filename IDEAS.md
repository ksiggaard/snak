# IDEAS

Captured as tasks in `TASKS.md` (2026-06-12) — add new ideas below and transform them
into tasks when they firm up.

1. Compact a chat (Claude Code-style, icon next to attachments) → **T28**
2. Incognito chats, deleted before the app closes → **T29**
3. Theme accent/background color pickers in Appearance → **T30**
4. Quick-input overlay: choose destination (new thread or last 5 chats) → **T31**
5. Language packs as JSON files / plugins (en, de, fr, pl, es, da bundled) → **T32**

6. Fonts + font sizes for UI and chat, from the Appearance panel → **T33**
7. Chat layout styles (bubbles etc.; current style default) → **T34**
8. Chat-list row styles (title default; title/date/model variants) → **T35**
9. Incognito distinctness: pre-chat explainer (provider still sees messages) + clear visual identity → **T36**
10. Local models from Hugging Face via the Ollama CLI (default plugin + setup instructions) → **T37**
11. "Bots" — named personas with avatars, personality, and per-bot editable memory → **T38**
12. Document attachments (pdf, docx, odt/ods/odp, xlsx, ppt, plain-text/code) parsed into chats + projects → **T39**

13. Richer Ollama daemon controls (start/stop, status, HF model install help) → **T41**
14. Mermaid chart rendering in chats (prebundled plugin, enabled by default) → **T42**
15. Personas: bots rebrand + profile fields, self-managed memory, mood (from chat, 2026-06-12) → **T40**
16. @-mention a persona in any chat for a one-shot, in-character reply to the chat context (tag more → all answer; reply shows the persona's name on top) → **T43**
17. Put animations into the UI. Not long but enough to make the applicaiton feel very polished and playful. I would like more fun in the chat. Transition effects between screens. Sidebars should animate in. Thinking animation with text animations. Incigneto playing on the ghost theme. Add option to appearance setting to toggle these animations. → **T46**
18. Bug: Jumping/flickering interface when hovering the chart in token usage screen. → **T47**
19. Bug: Responsive mode ultra narrow does not account for the topbar. The sidebar menu is not placed correctly. → **T48**
20. Bug: Quick chat CTRL+SPACE - It's loading models but never finding them. → **T49**
21. Quick chat should appear on the screen where the mouse cursor is. → **T50**
22. Default darkmode theme is Accent=#dc8add. Background=#163e54 and Mix color=#000000. It matches the logo better. → **T51**
23. Smaller models struggle to search the web for information. We need to make that possible. How do we make the harness find the URLs to fetch to gather information that the smaller models is missing.Extend browser plugin to include this functionality. → **T52**
24. Context size display in bottom of the chat. This allows us to know much context each chat consume in the model. → **T53**
25. Backgrounds on mermaid charts, when enlarged. → **T54**
26. Deep research mode. Activate in chat to allow the model to spend more time investigating something. If the model is doing tool calls then allow it to dispatch multiple simultanious subagents to gather the information that it seeks - The composer will also to able to run agents syncronously say it needs information A before it knows to gather information B to conclude something. The reason to use the subagents is to save context as each subagent operates with it's own context and will only work with the information that the main thread gives it. This will also save the main thread for context polution.
During this phase the UI should show the subagents being dispatched and their process status. Subagents will always try to respond with only the relevant information, at keep it to the point.


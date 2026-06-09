# snak

LLM chat app for KDE. Supporting Mistral, OpenAI, Antropic and Gemini API keys.

React based web app in Tauri with local database for chat history.

Left side panel stores all conversations, for picking up later.

Chat based app. Allows for multiple threads with LLM. Supports multimodal. Both images and text input. 

Allows it to run minimized with system tray icon and a trigger keyboard command.

Support creating screenshots to ask the LLM directly.

App will be exported to desktop app that can be installed on linux. Probably flatpack.


## IDEAS

1. Markdown support for responses

2. Canvas mode for editing long messages with markdown support.

3. Settings menu. 
This should include ability to append to system message.
Memory about user. 

4. Themes support for easy theming. This should be a folder structure with manifest file and style sheet file.
Documentation for applying easy styling with CSS variables.

5. Plugin support. Allow us to expand functionality with other LLMs. Plugins needs to be handled by category. Examples of plugins could be "add LLM X support", "Theme", "Custom skills".

6. MCP support. Out of the box MCP for browsing the web.

7. Slash command support. PLugins allows to install new custom plugins. Example of slash command "/terminal cat /path/to/file" could be a plugin that runs command in terminal and feeds output into chat window. 

8. Skills support.

9. Token usage tracking. Rich history of used models and tokens spent. Track input, output and cache tokens. Display in table and github style usage chat (The one with the colored squares).

10. When LLM responds with code as bash syntax. Add button to open terminal with the command.
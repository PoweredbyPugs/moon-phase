# Obsidian Moon Plugin

A simple Obsidian plugin that displays the current moon phase and sign.

## Features

- Adds a command to insert the current moon phase and sign into your note
- Displays the moon phase with an emoji
- Shows the current moon sign and degree

## Usage

1. Open the command palette (Ctrl/Cmd + P)
2. Search for "Insert current moon phase and sign"
3. Select the command to insert the information at your cursor position

## Example

The plugin will insert text like: 🌓 Gemini 16˚

## Requirements

- Requires access to the moon data server (local sweph.js server)

---

### Using Moon Phase Functions with Templater

The updated Moon Phase plugin now exposes functions that can be used with Templater to insert moon phase information in your templates.

#### Setup Instructions

1. Make sure both the **Moon Phase** and **Templater** plugins are installed and enabled
2. Create templates that use the moon phase functions (examples below)
3. Use Templater to create new notes with these templates

#### Available Functions

The Moon Phase plugin exposes the following functions through the global `window.MoonPhasePlugin` object:

|Function|Description|Example Output|
|---|---|---|
|`getCurrentMoonPhase()`|Returns the current moon phase emoji and sign|🌕 Libra|
|`getCurrentMoonDegree()`|Returns the current moon phase with specific degree|🌕 Libra 15.2˚|
|`getWeeklyPhase()`|Returns the major moon phase for the current week|🌓 Capricorn|

#### Example Templates

##### Simple Daily Note Template

```
---
date: <% tp.date.now("YYYY-MM-DD") %>
moon: <% await window.MoonPhasePlugin.getCurrentMoonPhase() %>
---

# <% tp.date.now("MMMM D, YYYY") %>

Today's moon is <% await window.MoonPhasePlugin.getCurrentMoonDegree() %>

## Tasks

- [ ] 

```

##### Journal Entry Template

```
---
date: <% tp.date.now("YYYY-MM-DD") %>
type: journal
moon: <% await window.MoonPhasePlugin.getCurrentMoonDegree() %>
weekly_phase: <% await window.MoonPhasePlugin.getWeeklyPhase() %>
---

# Journal: <% tp.date.now("dddd, MMMM D, YYYY") %>

**Current Moon**: <% await window.MoonPhasePlugin.getCurrentMoonPhase() %>
**Major Phase This Week**: <% await window.MoonPhasePlugin.getWeeklyPhase() %>

## Reflections

```

##### Astrology Entry Template

```
---
date: <% tp.date.now("YYYY-MM-DD") %>
type: astrology
---

# Astrological Notes: <% tp.date.now("MMMM D, YYYY") %>

## Moon Data
- Current Phase: <% await window.MoonPhasePlugin.getCurrentMoonPhase() %>
- Exact Position: <% await window.MoonPhasePlugin.getCurrentMoonDegree() %>
- Weekly Major Phase: <% await window.MoonPhasePlugin.getWeeklyPhase() %>

## Notes

```

#### Troubleshooting

- Make sure your Moon Phase plugin is running properly and can connect to your moon data server
- Check that the server address in the plugin is correct (currently set to http://10.0.0.74:3000)
- If templates show "Error fetching moon data" instead of moon information, check your browser console for detailed error messages
- Remember that these functions require an internet connection to work since they fetch data from your local server

#### Advanced Usage

You can also combine moon phase data with other Templater functions to create more complex templates:

```
<%
let moonPhase = await window.MoonPhasePlugin.getCurrentMoonPhase();
let weeklyPhase = await window.MoonPhasePlugin.getWeeklyPhase();
let reflectionPrompt = "";

// Create different reflection prompts based on moon phase
if (moonPhase.includes("🌑")) {
    reflectionPrompt = "What new beginnings are emerging in your life?";
} else if (moonPhase.includes("🌓")) {
    reflectionPrompt = "What challenges are you currently facing?";
} else if (moonPhase.includes("🌕")) {
    reflectionPrompt = "What is coming to completion or fruition?";
} else if (moonPhase.includes("🌗")) {
    reflectionPrompt = "What are you ready to release or let go of?";
} else {
    reflectionPrompt = "What phase of your life are you currently in?";
}
_%>

# Journal: <% tp.date.now("dddd, MMMM D, YYYY") %>

**Moon Today**: <% moonPhase %>
**Weekly Phase**: <% weeklyPhase %>

## Reflection Prompt
<% reflectionPrompt %>

## Notes
```

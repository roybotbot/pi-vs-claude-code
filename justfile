set dotenv-load := true

ext := "/Users/roy/Utilities/pi-vs-claude-code/extensions"
id := invocation_directory()

default:
    @just --list

# g1

# 1. default pi
pi:
    cd {{id}} && pi

# 2. Pure focus pi: strip footer and status line entirely
ext-pure-focus:
    cd {{id}} && pi -e {{ext}}/pure-focus.ts

# 3. Minimal pi: model name + 10-block context meter
ext-minimal:
    cd {{id}} && pi -e {{ext}}/minimal.ts -e {{ext}}/theme-cycler.ts

# 4. Cross-agent pi: load commands from .claude/, .gemini/, .codex/ dirs
ext-cross-agent:
    cd {{id}} && pi -e {{ext}}/cross-agent.ts -e {{ext}}/minimal.ts

# 5. Purpose gate pi: declare intent before working, persistent widget, focus the system prompt on the ONE PURPOSE for this agent
ext-purpose-gate:
    cd {{id}} && pi -e {{ext}}/purpose-gate.ts -e {{ext}}/minimal.ts

# 6. Customized footer pi: Tool counter, model, branch, cwd, cost, etc.
ext-tool-counter:
    cd {{id}} && pi -e {{ext}}/tool-counter.ts

# 7. Tool counter widget: tool call counts in a below-editor widget
ext-tool-counter-widget:
    cd {{id}} && pi -e {{ext}}/tool-counter-widget.ts -e {{ext}}/minimal.ts

# 8. Subagent widget: /sub <task> with live streaming progress
ext-subagent-widget:
    cd {{id}} && pi -e {{ext}}/subagent-widget.ts -e {{ext}}/pure-focus.ts -e {{ext}}/theme-cycler.ts

# 9. TillDone: task-driven discipline — define tasks before working
ext-tilldone:
    cd {{id}} && pi -e {{ext}}/tilldone.ts -e {{ext}}/theme-cycler.ts

ext-pushover:
    cd {{id}} && pi -e {{ext}}/pushover-notify.ts -e {{ext}}/minimal.ts

#g2

# 10. Agent team: dispatcher orchestrator with team select and grid dashboard
ext-agent-team:
    cd {{id}} && pi -e {{ext}}/agent-team.ts -e {{ext}}/theme-cycler.ts

# 11. System select: /system to pick an agent persona as system prompt
ext-system-select:
    cd {{id}} && pi -e {{ext}}/system-select.ts -e {{ext}}/minimal.ts -e {{ext}}/theme-cycler.ts

# 12. Launch with Damage-Control safety auditing
ext-damage-control:
    cd {{id}} && pi -e {{ext}}/damage-control.ts -e {{ext}}/minimal.ts -e {{ext}}/theme-cycler.ts

# 13. Agent chain: sequential pipeline orchestrator
ext-agent-chain:
    cd {{id}} && pi -e {{ext}}/agent-chain.ts -e {{ext}}/theme-cycler.ts

#g3

# 14. Pi Pi: meta-agent that builds Pi agents with parallel expert research
ext-pi-pi:
    cd {{id}} && pi -e {{ext}}/pi-pi.ts -e {{ext}}/theme-cycler.ts

#ext

# 15. Session Replay: scrollable timeline overlay of session history (legit)
ext-session-replay:
    cd {{id}} && pi -e {{ext}}/session-replay.ts -e {{ext}}/minimal.ts

# 16. Theme cycler: Ctrl+X forward, Ctrl+Q backward, /theme picker
ext-theme-cycler:
    cd {{id}} && pi -e {{ext}}/theme-cycler.ts -e {{ext}}/minimal.ts

# utils

# Open pi with one or more stacked extensions in a new tab: just open minimal tool-counter
open +exts:
    #!/usr/bin/env bash
    args=""
    for ext in {{exts}}; do
        args="$args -e {{ext}}/$ext.ts"
    done
    osascript -e "tell application \"iTerm\"
        activate
        tell current window
            set t to create tab with default profile
            tell current session of t
                write text \"cd '{{id}}' && pi$args\"
            end tell
        end tell
    end tell"

# Open every extension in its own terminal window
all:
    just open pi
    just open pure-focus 
    just open minimal theme-cycler
    just open cross-agent minimal
    just open purpose-gate minimal
    just open tool-counter
    just open tool-counter-widget minimal
    just open subagent-widget pure-focus theme-cycler
    just open tilldone theme-cycler
    just open agent-team theme-cycler
    just open system-select minimal theme-cycler
    just open damage-control minimal theme-cycler
    just open agent-chain theme-cycler
    just open pi-pi theme-cycler

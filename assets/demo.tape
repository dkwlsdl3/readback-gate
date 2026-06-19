Output assets/demo.gif

Set Shell "bash"
Set Width 960
Set Height 560
Set FontSize 18
Set Theme "Catppuccin Mocha"

Type "npm run build >/dev/null"
Enter
Sleep 1s

Type "printf '%s\n' '{\"prompt\":\"just clean everything up and handle it\"}' | node dist/adapters/codex.js"
Enter
Sleep 3s

Type "printf '%s\n' '{\"prompt\":\"Add a risk_level test to src/core/scorer.ts and verify with npm test\"}' | node dist/adapters/codex.js"
Enter
Sleep 2s

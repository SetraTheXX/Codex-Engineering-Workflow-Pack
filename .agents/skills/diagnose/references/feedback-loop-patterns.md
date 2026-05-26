# Feedback Loop Patterns

Pick the fastest reliable pass/fail signal that reaches the bug.

## Focused Test

Best when the project already has a test harness. Prefer integration-style tests through public behavior.

## CLI Fixture

Best for parsers, generators, import/export jobs, migrations, and data transforms.

Keep fixture files small and named for the scenario.

## HTTP Request

Best for API bugs. Use local server if available. Capture request body, status, response, and relevant logs.

## Browser Automation

Best for UI bugs where DOM, navigation, console errors, or network calls matter.

Assert on visible behavior, not screenshots alone.

## Replay

Best when production input caused the bug. Redact secrets before saving fixtures.

## Throwaway Harness

Best when setup is heavy but one public module can be exercised locally.

Mark the harness as temporary and remove it after the fix unless approved.

## Flake Loop

Best for intermittent behavior. Run the same command many times and record failure rate.

## Performance Measurement

Best for regressions in speed or resource use. Measure baseline, change one variable, and repeat.

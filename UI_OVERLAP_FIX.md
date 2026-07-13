# First-edit guide overlap fix

The first-edit guide previously used `position: fixed`, so it covered the viewport transform toolbar after a scene was generated.

The guide now participates in the editor workspace grid:

- creator workflow: row 1
- first-edit guide: row 2
- hierarchy, viewport, and inspector: row 3

When the guide is closed, its empty automatic row collapses. On displays below 820px tall, the guide hides its secondary sentence and uses a 44px compact height.

Browser smoke tests mount the guide and toolbar, measure their actual rectangles, and fail when they overlap.

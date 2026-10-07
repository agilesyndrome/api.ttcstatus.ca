# Snake map playability review

The explorer map remains the source of truth for TTC status. `buildSnakeMap`
creates a deliberately friendlier game board from a cloned bundle. The current
review found and addressed these small, deterministic improvements:

1. Keep the explorer input immutable.
2. Clear stale source edge attachments before graph surgery.
3. Keep terminal labels tied to their named boarding records.
4. Contract terminal approach fragments into one arrival.
5. Contract short multi-stage junction approaches.
6. Remove zero-length edges after every contraction pass.
7. Deduplicate reverse-ordered copies of the same centreline.
8. Union route labels when duplicate rails collapse.
9. Union infrastructure labels when duplicate rails collapse.
10. Preserve a signed terminal loop when a path intentionally traverses both copies.
11. Contract degree-two geometry nodes into longer corridors.
12. Refuse a contraction when a mission would use only half of the pair.
13. Preserve edge direction when rewriting mission references.
14. Preserve mission order while rewriting contracted pairs.
15. Preserve grade-separated crossings; proximity alone never makes a switch.
16. Simplify long polylines with a 24 m game tolerance.
17. Round ordinary corners with a bounded 22 m radius.
18. Leave tight terminal loops unrounded so they do not self-intersect.
19. Keep source-metre lengths authoritative after smoothing.
20. Rebuild display points and source-distance lookup arrays together.
21. Reattach every stop after topology changes.
22. Reattach every existing terminal to an actual game edge endpoint.
23. Keep route missions free of synthetic barn edges.
24. Add a simple, reversible Roncesvalles Carhouse entry.
25. Add a simple, reversible Russell Carhouse entry.
26. Split the main corridor at each barn entry instead of drawing a floating spur.
27. Mark barn spurs as game infrastructure so they are recognizable at switches.
28. Give each barn a real terminal node so arrival and automatic turnback work.
29. Keep barn route labels inherited from the connecting corridor.
30. Recompute bounds after the new spurs and terminal labels are attached.
31. Audit every edge, feature, and ordered mission after generation.
32. Drive every directed edge at extreme speed in regression tests.
33. Complete every production mission twice with a 30-car train in regression tests.
34. Trim a short tail track that dangles from a terminal, so a u-turn happens at
    the terminal point instead of 300 m down the layover stub.
35. Anchor a station's fake interchange on every line whose own track passes
    the station, so a crossing line (Line 1 / Line 6 at Finch West) gains its
    transfer even when no co-located platform record lists the other route.

The result is intentionally not a surveyed track inventory: it is a compact,
smooth, connected playground where a long train eventually collides with its
own actual trail instead of losing to a duplicated switch or an accidental
same-rail reversal.

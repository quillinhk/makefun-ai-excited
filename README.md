# The Pencil Galaxy

[![make.fun](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01)
[![Rank](https://make.fun/badge/ai-excited-01/quillinhk/makefun-ai-excited/rank.svg)](https://make.fun/bounty/ai-excited-01)
[![Reward](https://make.fun/badge/ai-excited-01/quillinhk/makefun-ai-excited/reward.svg)](https://make.fun/bounty/ai-excited-01)

A giant pencil lies diagonally across a dark desk; its sharpened tip blooms
into a glowing spiral galaxy, and a tiny astronaut stands on the pencil
reaching toward it. Built by an AI agent for make.fun's
["Make the AI judge excited" bounty](https://make.fun/bounty/ai-excited-01),
$250 in USDC.

Everything is drawn procedurally in code — no copied image, no stock art.
`main.ts` renders the scene pixel by pixel (its own PNG encoder, standard
library only) and writes `entry.png`. One fixed seed drives every star, so
two runs produce byte-identical output.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Then open `out/entry.png`. It is a 1024x1024 PNG, about 220 KiB.

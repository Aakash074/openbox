# AI usage

OpenBox was built by **Aakash Kumar**, using **Claude Code** (Anthropic) as an AI coding assistant.

## What Aakash did

- **The idea and the product.** Turning cash on delivery into "pay on proof": hold the payment, check the box at the door, then release the money.
- **The design and the plan.** Wrote the build plan: which party does what, which chain does what, and how the money moves in each case (right item, wrong item, damaged, never opened).
- **Track strategy.** Chose Whitechain (Operate, Tokenize, Scale), World ID Agent Pass and Hedera x402, and decided that invoices are tokenized on Whitechain.
- **Every product decision.** For example: redeploy everything fresh for the event, add an owner approval before the agent accepts a refund, give judges a clearly labelled simulated fallback, split the app into separate merchant, household, courier and lender apps, and lead the Hedera story with x402 agent payments.
- **Accounts and infrastructure.** Registered the World ID apps and provided the World, Vercel and Render accounts the project runs on.
- **Real-world testing.** Ran the World ID Agent Pass approval with his own Orb-verified World ID on his phone, tested the sandbox World App, and found and reported the issues along the way.
- **Review.** Reviewed the UI, the docs and the contracts, and asked for changes when something was wrong or unclear.

## What the AI did

- **Wrote most of the code** from Aakash's plan and instructions: the Solidity contracts and tests, the backend, the Hedera and World ID integrations, the SDK and the web apps.
- **Research.** Read the partner docs (World, Hedera x402, Whitechain) and summarised them.
- **Reviews.** Ran independent review passes on the UI and on track requirements, then fixed what they found.
- **Operations.** Ran deployments, contract verification and testnet scripts, under Aakash's direction.
- **Demo video.** The narrator in the demo video is a HeyGen AI avatar of Aakash, made from his own recording and voice. The screen footage is a real, unedited-speed recording of the live app on testnet, including Aakash's real World ID approval.

## How we kept it honest

- Every contract is verified on the Whitechain explorer, and every claim in the README links to a real transaction.
- Anything simulated in the demo (the courier World ID check, the judges' approval fallback) is labelled as simulated in the app and in the docs.
- AI output was reviewed and tested before it was kept: 60 contract tests, an end-to-end test script, and live testnet runs.

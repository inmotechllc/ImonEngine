#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/imon-engine}"
CLIPBAITERS_BUSINESS_ID="clipbaiters-viral-moments"

clipbaiters_state_flag() {
	local mode="$1"
	node --input-type=module - "$mode" <<'EOF'
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
const root = process.cwd();
const businessId = 'clipbaiters-viral-moments';
const businessesPath = path.join(root, 'runtime', 'state', 'businesses.json');
const planPath = path.join(root, 'runtime', 'ops', 'clipbaiters', businessId, 'plan.json');
const queuePath = path.join(root, 'runtime', 'state', 'clipbaiters', businessId, 'publishing-queue.json');

const businesses = existsSync(businessesPath) ? JSON.parse(readFileSync(businessesPath, 'utf8')) : [];
const business = businesses.find((entry) => entry.id === businessId);
const plan = existsSync(planPath) ? JSON.parse(readFileSync(planPath, 'utf8')) : null;
const queue = existsSync(queuePath) ? JSON.parse(readFileSync(queuePath, 'utf8')) : { items: [] };
const browser = process.env.CLIPBAITERS_BROWSER_STATUS
	? JSON.parse(process.env.CLIPBAITERS_BROWSER_STATUS)
	: {};

if (mode === 'autonomy-ready') {
	const stageReady = business && business.stage !== 'scaffolded';
	const planReady = plan && plan.status !== 'blocked';
	process.stdout.write(stageReady && planReady ? 'true' : 'false');
	process.exit(0);
}

if (mode === 'publish-ready') {
	const stageReady = business && business.stage !== 'scaffolded';
	const browserReady = browser.xvfbRunning === true && browser.chromeRunning === true && browser.devtoolsState === 'up';
	const hasApprovedRenderable = Array.isArray(queue.items)
		&& queue.items.some((item) => item.status === 'approved' && item.renderReady === true);
	process.stdout.write(stageReady && browserReady && hasApprovedRenderable ? 'true' : 'false');
	process.exit(0);
}

process.stdout.write('false');
EOF
}

cd "$APP_ROOT"
npm run dev -- engine-sync
npm run dev -- northline-autonomy-run --business auto-funding-agency --notify-roadblocks
npm run dev -- clipbaiters-plan --business "$CLIPBAITERS_BUSINESS_ID" --notify-roadblocks
npm run dev -- clipbaiters-collect --business clipbaiters-viral-moments
npm run dev -- clipbaiters-skim --business clipbaiters-viral-moments

if [[ "$(clipbaiters_state_flag autonomy-ready)" == "true" ]]; then
	npm run dev -- clipbaiters-autonomy-run --business "$CLIPBAITERS_BUSINESS_ID" --all-active-lanes
else
	npm run dev -- clipbaiters-autonomy-run --business "$CLIPBAITERS_BUSINESS_ID" --all-active-lanes --dry-run
fi

npm run dev -- clipbaiters-publish --business clipbaiters-viral-moments --all-active-lanes --dry-run

CLIPBAITERS_BROWSER_STATUS="$(scripts/vps-browser-status.sh 2>/dev/null || printf '{}')"
export CLIPBAITERS_BROWSER_STATUS
if [[ "$(clipbaiters_state_flag publish-ready)" == "true" ]]; then
	npm run dev -- clipbaiters-publish --business "$CLIPBAITERS_BUSINESS_ID" --all-active-lanes
fi
unset CLIPBAITERS_BROWSER_STATUS

npm run dev -- clipbaiters-source-creators --business clipbaiters-viral-moments
npm run dev -- clipbaiters-draft-creator-outreach --business clipbaiters-viral-moments
npm run dev -- clipbaiters-deals-report --business clipbaiters-viral-moments
npm run dev -- clipbaiters-monetization-report --business clipbaiters-viral-moments

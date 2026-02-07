type UpdateCheck = () => Promise<void>;
type LogFn = (message: string, data?: Record<string, unknown>) => void;

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

let started = false;
let timerId: NodeJS.Timeout | undefined;

export const startUpdateScheduler = (check: UpdateCheck, log?: LogFn): void => {
	if (started) {
		return;
	}
	started = true;
	const run = async () => {
		try {
			await check();
		} catch (error) {
			log?.("updateCheckSchedulerError", { error: String(error) });
		}
	};
	run().catch(() => {
		// errors are logged in run()
	});
	timerId = setInterval(() => {
		run().catch(() => {
			// errors are logged in run()
		});
	}, SIX_HOURS_MS);
};

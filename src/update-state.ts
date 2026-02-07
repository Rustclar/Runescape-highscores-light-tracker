let updateAvailable = false;

export const setUpdateAvailable = (value: boolean): void => {
	updateAvailable = value;
};

export const isUpdateAvailable = (): boolean => updateAvailable;

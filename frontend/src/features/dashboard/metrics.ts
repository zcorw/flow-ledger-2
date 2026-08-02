export const calculateNetWorth = (assets: number, liabilities: number) => assets - liabilities;
export const calculateForeignRatio = (foreignAssets: number, totalAssets: number) => totalAssets === 0 ? 0 : foreignAssets / totalAssets;

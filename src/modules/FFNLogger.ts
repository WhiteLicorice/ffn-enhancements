// modules/FFNLogger.ts

/**
 * Shared logging utility to prevent circular dependencies between Core and other modules.
 * Standardizes the logging format across the application.
 */
export const FFNLogger = {
    
    /**
     * Centralized logging function with standardized formatting.
     * @param page_name - The context/module name (e.g., 'doc-manager').
     * @param funcName - The specific function generating the log.
     * @param msg - The message to log.
     * @param data - Optional data object to log alongside the message.
     */
    log: function (page_name: string, funcName: string, msg: string, data?: any) {
        const prefix = `(ffn-enhancements) ${page_name} ${funcName}:`;
        if (data !== undefined) console.log(`${prefix} ${msg}`, data);
        else console.log(`${prefix} ${msg}`);
    },

    /**
     * Logger Factory: Returns a bound logging function for a specific context.
     * This prevents manual repetition of page and function names in every log call.
     * @param page_name - The context/module name.
     * @param funcName - The specific function name.
     * @returns A function that accepts (msg, data).
     */
    getLogger: function (page_name: string, funcName: string) {
        return (msg: string, data?: any) => {
            this.log(page_name, funcName, msg, data);
        };
    }
};
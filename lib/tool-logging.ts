type LoggableTool = {
  execute?: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};

export function previewForConsole(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function attachConsoleLoggingToTools<T extends Record<string, LoggableTool>>(
  prefix: string,
  tools: T,
): T {
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, toolDef]) => {
      if (typeof toolDef.execute !== "function") {
        return [toolName, toolDef];
      }

      const execute = toolDef.execute;

      return [
        toolName,
        {
          ...toolDef,
          execute: async (...args: unknown[]) => {
            const [input] = args;
            console.info(`[${prefix}][tool][start]`, {
              toolName,
              input: previewForConsole(input),
            });

            try {
              const result = await execute(...args);
              console.info(`[${prefix}][tool][result]`, {
                toolName,
                result: previewForConsole(result),
              });
              return result;
            } catch (error) {
              console.error(`[${prefix}][tool][error]`, {
                toolName,
                error:
                  error instanceof Error
                    ? {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                      }
                    : error,
              });
              throw error;
            }
          },
        },
      ];
    }),
  ) as T;
}

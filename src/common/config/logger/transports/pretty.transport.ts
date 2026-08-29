export const prettyTransport = {
  target: 'pino-pretty',
  options: {
    /**
     * Habilita colores ANSI.
     * sync: true ejecuta el transport en el mismo hilo (no worker)
     * para garantizar colores con nest start --watch.
     */
    colorize: true,

    /**
     * Colorea objetos JSON
     */
    colorizeObjects: true,

    /**
     * Formato de fecha/hora local.
     *
     * Ejemplo:
     * [08-05-2026 15:46:25.877]
     */
    translateTime: 'dd-mm-yyyy HH:MM:ss.l',

    /**
     * Oculta propiedades innecesarias
     * del logger base.
     */
    ignore: 'pid,hostname,context,req,res,environment,responseTime',

    /**
     * Formato visual de mensajes.
     *
     * Resultado:
     * (NestApplication) App started
     */
    messageFormat: '{if context}({context}) {end}{msg}',
  },
};

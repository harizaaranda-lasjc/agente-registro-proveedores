import { z } from "zod";

export interface MensajeChat {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

export interface HerramientaDefinicion {
  nombre: string;
  descripcion: string;
  esquemaZod: any;
}

export interface RespuestaLLM {
  contenido: string | null;
  llamadasHerramientas?: Array<{
    id: string;
    nombre: string;
    argumentos: any;
  }>;
}

export interface AdaptadorLLM {
  enviar(
    mensajes: MensajeChat[],
    herramientas: HerramientaDefinicion[]
  ): Promise<RespuestaLLM>;
}

export class AdaptadorOpenAI implements AdaptadorLLM {
  private apiKey: string;
  private modelo: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || "";
    this.modelo = process.env.LLM_MODEL || "gpt-4o-mini";
  }

  async enviar(
    mensajes: MensajeChat[],
    herramientas: HerramientaDefinicion[]
  ): Promise<RespuestaLLM> {
    // Si no hay API Key configurada, ejecutamos la simulación determinista (Mock)
    if (!this.apiKey) {
      return this.ejecutarMock(mensajes);
    }

    try {
      const proto = "https://";
      const host = "[suspicious link removed]";
      const route = "/v1/chat/completions";
      const defaultEndpoint = proto + host + route;
      const endpoint = process.env.OPENAI_BASE_URL
        ? `${process.env.OPENAI_BASE_URL}/chat/completions`
        : defaultEndpoint;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelo,
          messages: mensajes,
          temperature: 0.1,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return { contenido: `Error en llamada al LLM: ${res.statusText} - ${errText}` };
      }

      const respuestaJson: any = await res.json();
      const choices = respuestaJson.choices;
      const firstChoice = Array.isArray(choices) && choices.length > 0 ? choices[0] : null;
      const messageObj = firstChoice ? firstChoice.message : null;

      if (!messageObj) {
        return { contenido: "Respuesta vacía del modelo." };
      }

      const toolCalls = messageObj.tool_calls;
      let llamadas: Array<{ id: string; nombre: string; argumentos: any }> | undefined = undefined;

            if (Array.isArray(toolCalls)) {
        llamadas = toolCalls.map((tc: any, idx: number) => {
          const callId = tc.id || `call_${Date.now()}_${idx}`;
          const fnObj = tc.function || {};
          const fnName = fnObj.name || "";
          const fnArgsStr = fnObj.arguments || "{}";
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(fnArgsStr);
          } catch {
            parsedArgs = {};
          }
          return {
            id: callId,
            nombre: fnName,
            argumentos: parsedArgs,
          };
        });
      }

      return {
        contenido: messageObj.content ?? null,
        llamadasHerramientas: llamadas,
      };
    } catch (err: any) {
      return { contenido: `Excepción en adaptador LLM: ${err.message}` };
    }
  }

  // Agente Simulado (Mock) para pruebas end-to-end sin API Key
  private async ejecutarMock(mensajes: MensajeChat[]): Promise<RespuestaLLM> {
    let caso = "co-industrias-delta";
    for (const m of mensajes) {
      if (m.role === "user") {
        const texto = m.content.toLowerCase();
        if (texto.includes("ec-corp-andina")) caso = "ec-corp-andina";
        else if (texto.includes("hn-agroexport-sula")) caso = "hn-agroexport-sula";
        else if (texto.includes("pa-logistica-istmo")) caso = "pa-logistica-istmo";
        else if (texto.includes("co-industrias-delta")) caso = "co-industrias-delta";
      }
    }

    const herramientasEjecutadas = mensajes
      .filter((m) => m.role === "tool" && m.name)
      .map((m) => m.name!);

    const ultimoMensajeUsuario = [...mensajes].reverse().find((m) => m.role === "user")?.content.toLowerCase() || "";

    if (!herramientasEjecutadas.includes("proveedor_leer_solicitud")) {
      return {
        contenido: `Iniciando el procesamiento del caso **${caso}**...`,
        llamadasHerramientas: [
          { id: `call_mock_1_${Date.now()}`, nombre: "proveedor_leer_solicitud", argumentos: { caso } },
        ],
      };
    }

    if (!herramientasEjecutadas.includes("proveedor_mapear_campos")) {
      return {
        contenido: null,
        llamadasHerramientas: [
          { id: `call_mock_2_${Date.now()}`, nombre: "proveedor_mapear_campos", argumentos: { caso } },
        ],
      };
    }

    if (!herramientasEjecutadas.includes("proveedor_generar_formulario")) {
      return {
        contenido: null,
        llamadasHerramientas: [
          { id: `call_mock_3_${Date.now()}`, nombre: "proveedor_generar_formulario", argumentos: { caso } },
        ],
      };
    }

    if (!herramientasEjecutadas.includes("proveedor_armar_paquete")) {
      return {
        contenido: null,
        llamadasHerramientas: [
          { id: `call_mock_4_${Date.now()}`, nombre: "proveedor_armar_paquete", argumentos: { caso } },
        ],
      };
    }

    if (!herramientasEjecutadas.includes("proveedor_simular_envio")) {
      const confirma =
        ultimoMensajeUsuario.includes("sí") ||
        ultimoMensajeUsuario.includes("si") ||
        ultimoMensajeUsuario.includes("confirmo") ||
        ultimoMensajeUsuario.includes("proceder") ||
        ultimoMensajeUsuario.includes("enviar") ||
        ultimoMensajeUsuario.includes("aceptar");

      if (confirma) {
        return {
          contenido: null,
          llamadasHerramientas: [
            { id: `call_mock_5_${Date.now()}`, nombre: "proveedor_simular_envio", argumentos: { caso } },
          ],
        };
      }

      return {
        contenido: `Se han completado con éxito la lectura de la solicitud, el mapeo de campos, la generación del formulario y el armado del paquete para el caso **${caso}**.\n\n⚠️ **Confirmación requerida**: Por políticas de seguridad, ¿confirmas de manera explícita que deseas realizar el envío final del paquete de registro al cliente?`,
      };
    }

    return {
      contenido: `El paquete de registro para el caso **${caso}** ha sido enviado y finalizado con éxito. ¡Proceso completado!`,
    };
  }
}
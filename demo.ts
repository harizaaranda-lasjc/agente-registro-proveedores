import * as path from "path";
import {
  leer_solicitud,
  mapear_campos,
  generar_formulario,
  armar_paquete,
  simular_envio,
  ContextoHerramienta,
} from "./src/tools/proveedor";

const CASOS = [
  "co-industrias-delta",
  "ec-corp-andina",
  "hn-agroexport-sula",
  "pa-logistica-istmo",
];

async function ejecutarDemo() {
  console.log("==================================================================");
  console.log("🚀 EJECUCIÓN DE VERIFICACIÓN DETERMINISTA (demo.ts)");
  console.log("Agente de Registro de Proveedores — Periferia IT Group");
  console.log("==================================================================\n");

  const rootDir = process.cwd();

  for (const caso of CASOS) {
    console.log(`\n------------------------------------------------------------------`);
    console.log(`📌 PROCESANDO CASO: [ ${caso} ]`);
    console.log(`------------------------------------------------------------------`);

    const ctx: ContextoHerramienta = {
      directory: rootDir,
      sessionId: `demo-${caso}`,
    };

    // 1. Leer solicitud
    console.log("\n1️⃣  Ejecutando: proveedor_leer_solicitud...");
    const resLecturaStr = await leer_solicitud.execute({ caso }, ctx);
    const resLectura = JSON.parse(resLecturaStr);
    console.log(`   └─ País: ${resLectura.data?.pais} | Formato: ${resLectura.data?.formato} | Cliente: ${resLectura.data?.cliente}`);

    // 2. Mapear campos
    console.log("\n2️⃣  Ejecutando: proveedor_mapear_campos...");
    const resMapeoStr = await mapear_campos.execute(
      { caso, campos: resLectura.data?.campos || [] },
      ctx
    );
    const resMapeo = JSON.parse(resMapeoStr);
    console.log(
      `   └─ Llenos: ${resMapeo.data?.llenos?.length || 0} | Faltantes: ${resMapeo.data?.faltantes?.length || 0} | Requieren confirmación: ${resMapeo.data?.requiere_confirmacion?.length || 0}`
    );

    // 3. Generar formulario
    console.log("\n3️⃣  Ejecutando: proveedor_generar_formulario...");
    const resFormStr = await generar_formulario.execute({ caso, mapeo: resMapeo.data }, ctx);
    const resForm = JSON.parse(resFormStr);
    console.log(`   └─ Archivo generado en: ${resForm.data?.ruta}`);

    // 4. Armar paquete de soportes
    console.log("\n4️⃣  Ejecutando: proveedor_armar_paquete...");
    const resPaqueteStr = await armar_paquete.execute({ caso }, ctx);
    const resPaquete = JSON.parse(resPaqueteStr);
    console.log(`   └─ Listo para firma: ${resPaquete.data?.listo_para_firma ? "SÍ ✅" : "NO ❌"}`);
    console.log(`   └─ Checklist: ${resPaquete.data?.checklist?.length || 0} soportes evaluados.`);

    // 5. Simular envío final con confirmación
    console.log("\n5️⃣  Ejecutando: proveedor_simular_envio (confirmado: true)...");
    const resEnvioStr = await simular_envio.execute({ caso, confirmado: true }, ctx);
    const resEnvio = JSON.parse(resEnvioStr);
    console.log(`   └─ Resultado: ${resEnvio.data?.ruta || resEnvio.error}`);
  }

  console.log("\n==================================================================");
  console.log("✅ DEMO FINALIZADA CON ÉXITO PARA TODOS LOS CASOS");
  console.log("==================================================================\n");
}

ejecutarDemo().catch((err) => {
  console.error("❌ Error durante la ejecución de la demo:", err);
});
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readPublic=name=>readFile(new URL(`../public/${name}`,import.meta.url),"utf8");

test("main voice page offers real and anime modes in one conversation",async()=>{
  const [html,app,styles]=await Promise.all([readPublic("index.html"),readPublic("app.js"),readPublic("mode-switch.css")]);
  assert.match(html,/data-avatar-mode="real"[^>]*>真人/);
  assert.match(html,/data-avatar-mode="anime"[^>]*>动漫/);
  assert.match(html,/id="animeLookSelect"/);
  assert.match(html,/id="animeViewControls"/);
  assert.match(html,/id="personaForm"/);
  assert.match(html,/id="personaBackground"/);
  assert.match(html,/人物设置/);
  assert.match(app,/lumi-avatar-mode/);
  assert.match(app,/lumi-vrm-look/);
  assert.match(app,/lumi-vrm-persona/);
  assert.match(app,/\/wav2lip-avatar\/avatar\.html/);
  assert.match(app,/\/vrm-embed\.html/);
  assert.match(app,/history:history\.slice/);
  assert.match(styles,/portrait\[data-avatar-mode="anime"\] \.realistic-avatar \{ display: none !important; \}/);
  assert.match(styles,/\.avatar-panel \.portrait[\s\S]*position: absolute/);
});

test("embedded anime view receives shared speech and behavior events",async()=>{
  const [html,app]=await Promise.all([readPublic("vrm-embed.html"),readPublic("vrm-embed.js")]);
  assert.match(html,/id="avatarCanvas"/);
  assert.match(html,/vrm-embed\.js/);
  assert.match(app,/\|\|"nike1"/);
  for(const event of ["vrm-ready","vrm-behavior","vrm-speaking","vrm-audio-level","vrm-clear","vrm-finish-gesture","vrm-view-angle"])assert.match(app,new RegExp(event));
});

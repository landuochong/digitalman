import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { bindClientAbort } from "../src/client-abort.mjs";

test("aborts upstream work when the response closes before completion",()=>{
  const response=new EventEmitter(),lifecycle=bindClientAbort(response);
  response.emit("close");
  assert.equal(lifecycle.signal.aborted,true);
  assert.equal(lifecycle.signal.reason,"client-disconnected");
  assert.equal(lifecycle.completed,false);
});

test("normal completion detaches close without aborting upstream work",()=>{
  const response=new EventEmitter(),lifecycle=bindClientAbort(response);
  assert.equal(lifecycle.complete(),true);
  assert.equal(lifecycle.complete(),false);
  response.emit("close");
  assert.equal(lifecycle.signal.aborted,false);
  assert.equal(lifecycle.completed,true);
});

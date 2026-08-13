export class BoundedAsyncCache {
  constructor(limit = 64) {
    this.limit = Math.max(1, Number(limit) || 64);
    this.entries = new Map();
  }

  getOrCreate(key, create) {
    if (this.entries.has(key)) {
      const value = this.entries.get(key);
      this.entries.delete(key);
      this.entries.set(key, value);
      return { value, hit:true };
    }
    const value = Promise.resolve().then(create);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
    value.catch(() => { if (this.entries.get(key) === value) this.entries.delete(key); });
    return { value, hit:false };
  }

  get(key) {
    if (!this.entries.has(key)) return null;
    const value=this.entries.get(key);
    this.entries.delete(key);this.entries.set(key,value);
    return value;
  }

  set(key, value) {
    const stored=Promise.resolve(value);
    this.entries.delete(key);this.entries.set(key,stored);
    while(this.entries.size>this.limit)this.entries.delete(this.entries.keys().next().value);
    return stored;
  }
}

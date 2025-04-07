// 缓存策略接口
  export class CacheStrategy {
    constructor(maxItems, maxAge) {
      this.maxItems = maxItems;
      this.maxAge = maxAge;
    }
  
    async cleanup(store) {
      const expired = IDBKeyRange.upperBound(Date.now());
      let cursor = await store.index('expires').openCursor(expired);
      while (cursor) {
        cursor.delete();
        cursor = await cursor.continue();
      }
    
      const count = await store.count();
      if (count > this.maxItems) {
        let deleteCount = count - this.maxItems;
        cursor = await store.index('lastAccessed').openCursor(null, 'next');
        while (cursor && deleteCount-- > 0) {
          cursor.delete();
          cursor = await cursor.continue();
        }
      }
    }
  }
  
  // 时间+LRU混合策略
  /* eslint-disable-next-line no-unused-vars */
  // 修改后的缓存策略
  export class HybridStrategy extends CacheStrategy {
    cleanup(store) {
      return new Promise((resolve, reject) => {
        // 时间过期清理
        const expired = IDBKeyRange.upperBound(Date.now());
        const expireReq = store.index('expires').openCursor(expired);
        
        expireReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            cursor.delete();  // 在事务有效期内同步删除
            cursor.continue();
          } else {
            // LRU清理
            store.count().onsuccess = (countEvent) => {
              const count = countEvent.target.result;
              if (count > this.maxItems) {
                const deleteCount = count - this.maxItems;
                const lruReq = store.index('lastAccessed')
                  .openCursor(null, 'next');
                
                let deleted = 0;
                lruReq.onsuccess = (e) => {
                  const cursor = e.target.result;
                  if (cursor && deleted < deleteCount) {
                    cursor.delete();
                    deleted++;
                    cursor.continue();
                  } else {
                    resolve();
                  }
                };
              } else {
                resolve();
              }
            };
          }
        };
        
        expireReq.onerror = reject;
      });
    }
  }
  
  // 如果需要使用 HybridStrategy，请确保实例化
  // const strategy = new HybridStrategy(100, 3600000 * 24 * 7);
  
  // 主缓存类
  export default class CacheManager {
    constructor(name, version, strategy) {
      this.db = null;
      this.name = name;
      this.version = version;
      this.strategy = strategy;
      this.storeName = 'tileCache';
      this.metrics = {
        hits: 0,
        misses: 0,
        lastError: null
      };
    }
  
    async init() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.name, this.version);
  
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            const store = db.createObjectStore(this.storeName, {
              keyPath: 'tileKey'
            });
            store.createIndex('lastAccessed', 'lastAccessed');
            store.createIndex('expires', 'expires');
          }
        };
  
        request.onsuccess = (e) => {
          this.db = e.target.result;
          this._startAutoCleanup();
          resolve();
        };
  
        request.onerror = (e) => {
          this._handleError(e.target.error);
          reject(e.target.error);
        };
      });
    }
  
    async get(tileKey) {
      try {
        const tx = this.db.transaction(this.storeName);
        const store = tx.objectStore(this.storeName);
        const data = await store.get(tileKey);
  
        if (data?.expires > Date.now()) {
          this.metrics.hits++;
          await this._updateLastAccessed(store, tileKey);
          return data.geojson;
        }
        
        this.metrics.misses++;
        return null;
      } catch (error) {
        this._handleError(error);
        return null;
      }
    }
  
    async set(tileKey, geojson) {
      try {
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        await store.put({
          tileKey,
          geojson,
          lastAccessed: Date.now(),
          expires: Date.now() + this.strategy.maxAge
        });
        return true;
      } catch (error) {
        this._handleError(error);
        return false;
      }
    }
  
    async _updateLastAccessed(store, tileKey) {
      const data = await store.get(tileKey);
      if (data) {
        data.lastAccessed = Date.now();
        await store.put(data);
      }
    }
  
    _startAutoCleanup() {
      // 从60秒调整为300秒（5分钟）
      setInterval(() => this._performCleanup(), 300 * 1000); 
    }
    async _performCleanup() {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      await this.strategy.cleanup(tx.objectStore(this.storeName));
    }
  
    _handleError(error) {
      this.metrics.lastError = {
        time: new Date(),
        message: error.message,
        code: error.name
      };
      console.error('Cache Error:', error);
    }
  
    getMetrics() {
      return {
        ...this.metrics,
        hitRate: this.metrics.hits / (this.metrics.hits + this.metrics.misses) || 0
      };
    }
  }
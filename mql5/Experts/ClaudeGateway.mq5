//+------------------------------------------------------------------+
//|                                               ClaudeGateway.mq5  |
//|  TCP gateway between MetaTrader 5 and an external controller     |
//|  (Python MCP server used by Claude Code).                        |
//|                                                                  |
//|  The EA is a TCP *client*: it connects to InpHost:InpPort,       |
//|  receives one request per line and answers with one JSON line.   |
//|                                                                  |
//|  Request : id=1<TAB>cmd=place_order<TAB>symbol=EURUSD<TAB>...    |
//|  Response: {"id":1,"ok":true,"result":{...}}                     |
//|            {"id":1,"ok":false,"error":"..."}                     |
//|                                                                  |
//|  All risk limits are enforced HERE, independently of the caller. |
//|  The kill switch can be turned back on only from the chart.      |
//+------------------------------------------------------------------+
#property copyright   "ClaudCode"
#property version     "1.00"
#property description "TCP gateway for Claude Code with hard risk limits"

#include <Trade\Trade.mqh>

#define CG_VERSION  "1.0.0"
#define BTN_TOGGLE  "CG_BTN_TOGGLE"
#define BTN_FLAT    "CG_BTN_FLAT"

input group "Connection"
input string InpHost              = "127.0.0.1"; // Bridge host (add it to allowed URLs)
input int    InpPort              = 5555;        // Bridge port
input int    InpReconnectSec      = 3;           // Reconnect interval, seconds

input group "Identity"
input ulong  InpMagic             = 20261007;    // Magic number of API trades
input string InpAllowedSymbols    = "EURUSD,GBPUSD,USDJPY,XAUUSD"; // Tradable symbols ("*" = any)

input group "Risk limits"
input bool   InpReadOnly          = false;       // Read-only API (no trading at all)
input bool   InpStartEnabled      = true;        // Trading enabled on start
input double InpMaxLot            = 0.10;        // Max volume per order, lots
input double InpMaxRiskPct        = 1.0;         // Max risk per trade, % of equity
input double InpMaxDailyLossPct   = 3.0;         // Daily loss limit, % of day-start equity
input bool   InpCloseOnDailyLoss  = true;        // Close API positions when daily limit is hit
input int    InpMaxOpenPositions  = 3;           // Max open API positions + pending orders
input int    InpMaxTradesPerDay   = 10;          // Max new API entries per day
input int    InpMinSecondsBetween = 60;          // Min seconds between new entries
input int    InpMaxSpreadPoints   = 30;          // Max spread for new entries, points (0 = off)
input bool   InpRequireSL         = true;        // Stop loss is mandatory
input bool   InpOnlyTightenSL     = true;        // SL may only be moved in favour of the position
input int    InpDeviationPoints   = 10;          // Max slippage, points

input group "Session (server time)"
input int    InpStartHour         = 8;           // New entries allowed from (hour)
input int    InpEndHour           = 21;          // New entries allowed until (hour)
input int    InpFlattenHour       = 22;          // Close all API positions at (hour, -1 = off)
input int    InpFlattenMinute     = 45;          // ... minute
input int    InpMaxBars           = 1000;        // Max bars per rates request

//--- state
CTrade   g_trade;
int      g_sock          = INVALID_HANDLE;
string   g_rx            = "";
datetime g_lastConnTry   = 0;
bool     g_enabled       = true;
datetime g_lastTradeTime = 0;
datetime g_lastHousekeep = 0;
datetime g_lastFlatTry   = 0;
string   g_symbols[];
bool     g_allSymbols    = false;
string   g_keys[];
string   g_vals[];

//+------------------------------------------------------------------+
//| JSON helpers                                                     |
//+------------------------------------------------------------------+
string JEsc(const string s)
  {
   string r = "";
   int n = StringLen(s);
   for(int i = 0; i < n; i++)
     {
      ushort c = StringGetCharacter(s, i);
      if(c == '"')        r += "\\\"";
      else if(c == '\\')  r += "\\\\";
      else if(c == '\n')  r += "\\n";
      else if(c == '\r')  r += "\\r";
      else if(c == '\t')  r += "\\t";
      else if(c < 32)     r += StringFormat("\\u%04x", c);
      else                r += ShortToString(c);
     }
   return r;
  }

string Num(const double v, const int digits = 8)
  {
   if(!MathIsValidNumber(v))
      return "null";
   string s = DoubleToString(v, digits);
   if(StringFind(s, ".") >= 0)
     {
      int n = StringLen(s);
      while(n > 0 && StringGetCharacter(s, n - 1) == '0')
         n--;
      if(n > 0 && StringGetCharacter(s, n - 1) == '.')
         n--;
      s = StringSubstr(s, 0, n);
     }
   if(s == "-0" || s == "")
      s = "0";
   return s;
  }

string Quote(const string s) { return "\"" + JEsc(s) + "\""; }

class JObj
  {
private:
   string            m_s;
   bool              m_first;
   void              Key(const string k)
     {
      if(!m_first)
         m_s += ",";
      m_first = false;
      m_s += Quote(k) + ":";
     }
public:
                     JObj() { m_s = "{"; m_first = true; }
   void              S(const string k, const string v)         { Key(k); m_s += Quote(v); }
   void              D(const string k, const double v, int d=8) { Key(k); m_s += Num(v, d); }
   void              I(const string k, const long v)            { Key(k); m_s += IntegerToString(v); }
   void              B(const string k, const bool v)            { Key(k); m_s += (v ? "true" : "false"); }
   void              R(const string k, const string raw)        { Key(k); m_s += raw; }
   string            Done() { return m_s + "}"; }
  };

//+------------------------------------------------------------------+
//| Request parameters (key=value, TAB separated)                    |
//+------------------------------------------------------------------+
void ParseRequest(const string line)
  {
   string parts[];
   int n = StringSplit(line, '\t', parts);
   if(n < 0)
      n = 0;
   ArrayResize(g_keys, n);
   ArrayResize(g_vals, n);
   for(int i = 0; i < n; i++)
     {
      int eq = StringFind(parts[i], "=");
      if(eq < 0)
        {
         g_keys[i] = parts[i];
         g_vals[i] = "";
        }
      else
        {
         g_keys[i] = StringSubstr(parts[i], 0, eq);
         g_vals[i] = StringSubstr(parts[i], eq + 1);
        }
     }
  }

bool Has(const string k)
  {
   for(int i = 0; i < ArraySize(g_keys); i++)
      if(g_keys[i] == k && g_vals[i] != "")
         return true;
   return false;
  }

string PStr(const string k, const string def)
  {
   for(int i = 0; i < ArraySize(g_keys); i++)
      if(g_keys[i] == k && g_vals[i] != "")
         return g_vals[i];
   return def;
  }

double PDbl(const string k, const double def)
  {
   if(!Has(k))
      return def;
   return StringToDouble(PStr(k, ""));
  }

long PLong(const string k, const long def)
  {
   if(!Has(k))
      return def;
   return StringToInteger(PStr(k, ""));
  }

//+------------------------------------------------------------------+
//| Time / day helpers (server time)                                 |
//+------------------------------------------------------------------+
datetime Now() { return TimeTradeServer(); }

int DayKey(const datetime t)
  {
   MqlDateTime d;
   TimeToStruct(t, d);
   return d.year * 10000 + d.mon * 100 + d.day;
  }

datetime DayStart(const datetime t)
  {
   MqlDateTime d;
   TimeToStruct(t, d);
   d.hour = 0;
   d.min = 0;
   d.sec = 0;
   return StructToTime(d);
  }

string GvPrefix()
  {
   return "CG_" + IntegerToString((long)InpMagic) + "_" +
          IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_";
  }

double DayStartEquity()
  {
   string name = GvPrefix() + "dse_" + IntegerToString(DayKey(Now()));
   if(!GlobalVariableCheck(name))
      GlobalVariableSet(name, AccountInfoDouble(ACCOUNT_EQUITY));
   return GlobalVariableGet(name);
  }

double DailyPnl() { return AccountInfoDouble(ACCOUNT_EQUITY) - DayStartEquity(); }

// Latching: once hit, stays locked until the next server day.
bool DailyLossLocked()
  {
   string name = GvPrefix() + "lock_" + IntegerToString(DayKey(Now()));
   if(GlobalVariableCheck(name))
      return true;
   double dse = DayStartEquity();
   if(InpMaxDailyLossPct > 0 && dse > 0 &&
      AccountInfoDouble(ACCOUNT_EQUITY) <= dse * (1.0 - InpMaxDailyLossPct / 100.0))
     {
      GlobalVariableSet(name, 1);
      PrintFormat("ClaudeGateway: DAILY LOSS LIMIT HIT (equity %.2f, day start %.2f). New entries blocked until next day.",
                  AccountInfoDouble(ACCOUNT_EQUITY), dse);
      return true;
     }
   return false;
  }

bool InTradingWindow()
  {
   MqlDateTime d;
   TimeToStruct(Now(), d);
   int h = d.hour;
   if(InpStartHour == InpEndHour)
      return true;
   if(InpStartHour < InpEndHour)
      return (h >= InpStartHour && h < InpEndHour);
   return (h >= InpStartHour || h < InpEndHour);
  }

bool PastFlatten()
  {
   if(InpFlattenHour < 0)
      return false;
   MqlDateTime d;
   TimeToStruct(Now(), d);
   return (d.hour * 60 + d.min >= InpFlattenHour * 60 + InpFlattenMinute);
  }

//+------------------------------------------------------------------+
//| Symbols / counters                                               |
//+------------------------------------------------------------------+
void ParseSymbols()
  {
   string parts[];
   int n = StringSplit(InpAllowedSymbols, ',', parts);
   ArrayResize(g_symbols, 0);
   g_allSymbols = false;
   for(int i = 0; i < n; i++)
     {
      string s = parts[i];
      StringTrimLeft(s);
      StringTrimRight(s);
      if(s == "")
         continue;
      if(s == "*")
        {
         g_allSymbols = true;
         continue;
        }
      int k = ArraySize(g_symbols);
      ArrayResize(g_symbols, k + 1);
      g_symbols[k] = s;
     }
  }

bool SymbolAllowed(const string s)
  {
   if(g_allSymbols)
      return true;
   for(int i = 0; i < ArraySize(g_symbols); i++)
      if(g_symbols[i] == s)
         return true;
   return false;
  }

bool IsManaged(const long magic) { return ((ulong)magic == InpMagic); }

int ManagedPositions()
  {
   int c = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t > 0 && IsManaged(PositionGetInteger(POSITION_MAGIC)))
         c++;
     }
   return c;
  }

int ManagedOrders()
  {
   int c = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong t = OrderGetTicket(i);
      if(t > 0 && IsManaged(OrderGetInteger(ORDER_MAGIC)))
         c++;
     }
   return c;
  }

int TradesToday()
  {
   datetime from = DayStart(Now());
   if(!HistorySelect(from, Now() + 86400))
      return 0;
   int c = 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0 || !IsManaged(HistoryDealGetInteger(d, DEAL_MAGIC)))
         continue;
      if(HistoryDealGetInteger(d, DEAL_ENTRY) == DEAL_ENTRY_IN)
         c++;
     }
   return c;
  }

//+------------------------------------------------------------------+
//| Price / volume helpers                                           |
//+------------------------------------------------------------------+
double NormPrice(const string sym, double p)
  {
   if(p <= 0)
      return 0.0;
   double ts = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   if(ts > 0)
      p = MathRound(p / ts) * ts;
   return NormalizeDouble(p, dg);
  }

int VolDigits(const double step)
  {
   int d = 0;
   while(d < 8)
     {
      double x = step * MathPow(10, d);
      if(MathAbs(x - MathRound(x)) < 1e-9)
         break;
      d++;
     }
   return d;
  }

double NormVolume(const string sym, double v)
  {
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   if(step <= 0)
      step = 0.01;
   v = MathFloor(v / step + 1e-9) * step;
   return NormalizeDouble(v, VolDigits(step));
  }

// Positive number = money lost if price goes from entry to sl.
bool LossAtSL(const string sym, const bool isBuy, const double vol,
              const double entry, const double sl, double &loss)
  {
   double p = 0.0;
   if(!OrderCalcProfit(isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, sym, vol, entry, sl, p))
      return false;
   loss = -p;
   return true;
  }

double StopsDistance(const string sym)
  {
   return (double)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL) * SymbolInfoDouble(sym, SYMBOL_POINT);
  }

bool RetcodeOk(const uint rc)
  {
   return (rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_DONE_PARTIAL || rc == TRADE_RETCODE_PLACED);
  }

string TradeError(const string what)
  {
   return StringFormat("%s rejected: retcode %u (%s)", what, g_trade.ResultRetcode(),
                       g_trade.ResultRetcodeDescription());
  }

bool ParseTf(string s, ENUM_TIMEFRAMES &tf)
  {
   StringToUpper(s);
   string names[] = {"M1", "M2", "M3", "M5", "M10", "M15", "M20", "M30",
                     "H1", "H2", "H3", "H4", "H6", "H8", "H12", "D1", "W1", "MN1"
                    };
   ENUM_TIMEFRAMES vals[] = {PERIOD_M1, PERIOD_M2, PERIOD_M3, PERIOD_M5, PERIOD_M10, PERIOD_M15, PERIOD_M20, PERIOD_M30,
                             PERIOD_H1, PERIOD_H2, PERIOD_H3, PERIOD_H4, PERIOD_H6, PERIOD_H8, PERIOD_H12, PERIOD_D1, PERIOD_W1, PERIOD_MN1
                            };
   for(int i = 0; i < ArraySize(names); i++)
      if(names[i] == s)
        {
         tf = vals[i];
         return true;
        }
   return false;
  }

string PositionTypeName(const long t) { return (t == POSITION_TYPE_BUY ? "buy" : "sell"); }

string OrderTypeName(const long t)
  {
   switch((int)t)
     {
      case ORDER_TYPE_BUY:             return "buy";
      case ORDER_TYPE_SELL:            return "sell";
      case ORDER_TYPE_BUY_LIMIT:       return "buy_limit";
      case ORDER_TYPE_SELL_LIMIT:      return "sell_limit";
      case ORDER_TYPE_BUY_STOP:        return "buy_stop";
      case ORDER_TYPE_SELL_STOP:       return "sell_stop";
      case ORDER_TYPE_BUY_STOP_LIMIT:  return "buy_stop_limit";
      case ORDER_TYPE_SELL_STOP_LIMIT: return "sell_stop_limit";
     }
   return "other";
  }

string DealEntryName(const long e)
  {
   switch((int)e)
     {
      case DEAL_ENTRY_IN:     return "in";
      case DEAL_ENTRY_OUT:    return "out";
      case DEAL_ENTRY_INOUT:  return "inout";
      case DEAL_ENTRY_OUT_BY: return "out_by";
     }
   return "other";
  }

//+------------------------------------------------------------------+
//| Kill switch                                                      |
//+------------------------------------------------------------------+
void SetEnabled(const bool on, const string why)
  {
   g_enabled = on;
   GlobalVariableSet(GvPrefix() + "enabled", on ? 1.0 : 0.0);
   PrintFormat("ClaudeGateway: trading %s (%s)", on ? "ENABLED" : "DISABLED", why);
   UpdateButtons();
  }

void MakeButton(const string name, const int x, const int y, const int w, const int h)
  {
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 9);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_STATE, false);
  }

void UpdateButtons()
  {
   if(ObjectFind(0, BTN_TOGGLE) >= 0)
     {
      ObjectSetString(0, BTN_TOGGLE, OBJPROP_TEXT, g_enabled ? "API TRADING: ON (click = stop)" : "API TRADING: OFF (click = start)");
      ObjectSetInteger(0, BTN_TOGGLE, OBJPROP_BGCOLOR, g_enabled ? clrForestGreen : clrDimGray);
     }
   if(ObjectFind(0, BTN_FLAT) >= 0)
     {
      ObjectSetString(0, BTN_FLAT, OBJPROP_TEXT, "CLOSE ALL API + STOP");
      ObjectSetInteger(0, BTN_FLAT, OBJPROP_BGCOLOR, clrFireBrick);
     }
   ChartRedraw();
  }

//+------------------------------------------------------------------+
//| Close everything managed by this EA                              |
//+------------------------------------------------------------------+
void CloseAllManaged(const string symbolFilter, int &closed, int &deleted, int &failed)
  {
   closed = 0;
   deleted = 0;
   failed = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !IsManaged(PositionGetInteger(POSITION_MAGIC)))
         continue;
      if(symbolFilter != "" && PositionGetString(POSITION_SYMBOL) != symbolFilter)
         continue;
      if(g_trade.PositionClose(t) && RetcodeOk(g_trade.ResultRetcode()))
         closed++;
      else
        {
         failed++;
         Print("ClaudeGateway: ", TradeError("close #" + IntegerToString((long)t)));
        }
     }
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong t = OrderGetTicket(i);
      if(t == 0 || !IsManaged(OrderGetInteger(ORDER_MAGIC)))
         continue;
      if(symbolFilter != "" && OrderGetString(ORDER_SYMBOL) != symbolFilter)
         continue;
      if(g_trade.OrderDelete(t) && RetcodeOk(g_trade.ResultRetcode()))
         deleted++;
      else
        {
         failed++;
         Print("ClaudeGateway: ", TradeError("delete #" + IntegerToString((long)t)));
        }
     }
  }

//+------------------------------------------------------------------+
//| Guards                                                           |
//+------------------------------------------------------------------+
bool CheckCanModify(string &err)
  {
   if(InpReadOnly)
     {
      err = "EA is in read-only mode";
      return false;
     }
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
     {
      err = "Algo Trading is disabled in the terminal (toolbar button)";
      return false;
     }
   if(!MQLInfoInteger(MQL_TRADE_ALLOWED))
     {
      err = "algo trading is not allowed for this EA (EA properties -> Common)";
      return false;
     }
   if(!AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
     {
      err = "trading is not allowed for this account (investor password?)";
      return false;
     }
   return true;
  }

bool CheckCanOpen(string &err)
  {
   if(!CheckCanModify(err))
      return false;
   if(!g_enabled)
     {
      err = "API trading is stopped by the kill switch; only the human can re-enable it on the chart";
      return false;
     }
   if(!InTradingWindow())
     {
      err = StringFormat("outside trading window %02d:00-%02d:00 server time", InpStartHour, InpEndHour);
      return false;
     }
   if(PastFlatten())
     {
      err = StringFormat("past daily flatten time %02d:%02d server time", InpFlattenHour, InpFlattenMinute);
      return false;
     }
   if(DailyLossLocked())
     {
      err = StringFormat("daily loss limit %.2f%% reached; new entries blocked until next server day", InpMaxDailyLossPct);
      return false;
     }
   int open = ManagedPositions() + ManagedOrders();
   if(InpMaxOpenPositions > 0 && open >= InpMaxOpenPositions)
     {
      err = StringFormat("max open positions/orders reached (%d/%d)", open, InpMaxOpenPositions);
      return false;
     }
   int today = TradesToday();
   if(InpMaxTradesPerDay > 0 && today >= InpMaxTradesPerDay)
     {
      err = StringFormat("max trades per day reached (%d/%d)", today, InpMaxTradesPerDay);
      return false;
     }
   if(InpMinSecondsBetween > 0 && g_lastTradeTime > 0)
     {
      long wait = InpMinSecondsBetween - (long)(Now() - g_lastTradeTime);
      if(wait > 0)
        {
         err = StringFormat("cooldown: next entry allowed in %d s", (int)wait);
         return false;
        }
     }
   return true;
  }

bool CheckSymbolForEntry(const string sym, const bool isBuy, string &err)
  {
   if(sym == "")
     {
      err = "symbol is required";
      return false;
     }
   if(!SymbolAllowed(sym))
     {
      err = "symbol " + sym + " is not in the allowed list: " + InpAllowedSymbols;
      return false;
     }
   if(!SymbolSelect(sym, true))
     {
      err = "unknown symbol " + sym;
      return false;
     }
   long mode = SymbolInfoInteger(sym, SYMBOL_TRADE_MODE);
   if(mode == SYMBOL_TRADE_MODE_DISABLED || mode == SYMBOL_TRADE_MODE_CLOSEONLY)
     {
      err = "trading is disabled or close-only for " + sym;
      return false;
     }
   if(mode == SYMBOL_TRADE_MODE_LONGONLY && !isBuy)
     {
      err = sym + " is long-only";
      return false;
     }
   if(mode == SYMBOL_TRADE_MODE_SHORTONLY && isBuy)
     {
      err = sym + " is short-only";
      return false;
     }
   int spread = (int)SymbolInfoInteger(sym, SYMBOL_SPREAD);
   if(InpMaxSpreadPoints > 0 && spread > InpMaxSpreadPoints)
     {
      err = StringFormat("spread %d points exceeds max %d", spread, InpMaxSpreadPoints);
      return false;
     }
   return true;
  }

//+------------------------------------------------------------------+
//| Commands: read                                                   |
//+------------------------------------------------------------------+
string GuardJson()
  {
   double dse = DayStartEquity();
   double pnl = DailyPnl();
   MqlDateTime d;
   TimeToStruct(Now(), d);
   JObj o;
   o.B("trading_enabled", g_enabled);
   o.B("read_only", InpReadOnly);
   o.B("daily_loss_locked", DailyLossLocked());
   o.B("in_trading_window", InTradingWindow());
   o.B("past_flatten_time", PastFlatten());
   o.D("day_start_equity", dse, 2);
   o.D("daily_pnl", pnl, 2);
   o.D("daily_pnl_pct", dse > 0 ? pnl / dse * 100.0 : 0.0, 3);
   o.D("max_daily_loss_pct", InpMaxDailyLossPct, 2);
   o.I("trades_today", TradesToday());
   o.I("max_trades_per_day", InpMaxTradesPerDay);
   o.I("open_positions", ManagedPositions());
   o.I("pending_orders", ManagedOrders());
   o.I("max_open_positions", InpMaxOpenPositions);
   o.D("max_lot", InpMaxLot, 2);
   o.D("max_risk_pct", InpMaxRiskPct, 2);
   o.I("max_spread_points", InpMaxSpreadPoints);
   o.B("require_sl", InpRequireSL);
   o.B("only_tighten_sl", InpOnlyTightenSL);
   o.I("min_seconds_between", InpMinSecondsBetween);
   o.S("allowed_symbols", InpAllowedSymbols);
   o.S("trading_window", StringFormat("%02d:00-%02d:00", InpStartHour, InpEndHour));
   o.S("flatten_time", InpFlattenHour < 0 ? "off" : StringFormat("%02d:%02d", InpFlattenHour, InpFlattenMinute));
   o.S("server_time", TimeToString(Now(), TIME_DATE | TIME_SECONDS));
   o.I("server_weekday", d.day_of_week);
   return o.Done();
  }

bool CmdPing(string &out, string &err)
  {
   JObj o;
   o.B("pong", true);
   o.S("version", CG_VERSION);
   o.I("magic", (long)InpMagic);
   o.S("server_time", TimeToString(Now(), TIME_DATE | TIME_SECONDS));
   o.I("server_time_unix", (long)Now());
   o.I("server_gmt_offset_sec", (long)(Now() - TimeGMT()));
   o.B("terminal_connected", (bool)TerminalInfoInteger(TERMINAL_CONNECTED));
   out = o.Done();
   return true;
  }

bool CmdAccount(string &out, string &err)
  {
   long tm = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   long mm = AccountInfoInteger(ACCOUNT_MARGIN_MODE);
   JObj o;
   o.I("login", AccountInfoInteger(ACCOUNT_LOGIN));
   o.S("server", AccountInfoString(ACCOUNT_SERVER));
   o.S("company", AccountInfoString(ACCOUNT_COMPANY));
   o.S("currency", AccountInfoString(ACCOUNT_CURRENCY));
   o.S("trade_mode", tm == ACCOUNT_TRADE_MODE_DEMO ? "demo" : (tm == ACCOUNT_TRADE_MODE_CONTEST ? "contest" : "real"));
   o.S("margin_mode", mm == ACCOUNT_MARGIN_MODE_RETAIL_HEDGING ? "hedging" : "netting");
   o.I("leverage", AccountInfoInteger(ACCOUNT_LEVERAGE));
   o.D("balance", AccountInfoDouble(ACCOUNT_BALANCE), 2);
   o.D("equity", AccountInfoDouble(ACCOUNT_EQUITY), 2);
   o.D("profit", AccountInfoDouble(ACCOUNT_PROFIT), 2);
   o.D("margin", AccountInfoDouble(ACCOUNT_MARGIN), 2);
   o.D("margin_free", AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2);
   o.D("margin_level", AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), 2);
   o.B("terminal_trade_allowed", (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED));
   o.B("ea_trade_allowed", (bool)MQLInfoInteger(MQL_TRADE_ALLOWED));
   o.B("account_trade_allowed", (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED));
   o.R("guard", GuardJson());
   out = o.Done();
   return true;
  }

bool CmdGuard(string &out, string &err)
  {
   out = GuardJson();
   return true;
  }

bool CmdSymbol(string &out, string &err)
  {
   string sym = PStr("symbol", "");
   if(sym == "" || !SymbolSelect(sym, true))
     {
      err = "unknown symbol '" + sym + "'";
      return false;
     }
   MqlTick tk;
   if(!SymbolInfoTick(sym, tk))
     {
      err = "no tick data for " + sym;
      return false;
     }
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   long mode = SymbolInfoInteger(sym, SYMBOL_TRADE_MODE);
   JObj o;
   o.S("symbol", sym);
   o.S("description", SymbolInfoString(sym, SYMBOL_DESCRIPTION));
   o.D("bid", tk.bid, dg);
   o.D("ask", tk.ask, dg);
   o.I("spread_points", SymbolInfoInteger(sym, SYMBOL_SPREAD));
   o.I("digits", dg);
   o.D("point", SymbolInfoDouble(sym, SYMBOL_POINT), 10);
   o.D("tick_size", SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE), 10);
   o.D("tick_value", SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE), 6);
   o.D("contract_size", SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE), 2);
   o.D("volume_min", SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN), 4);
   o.D("volume_max", SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX), 4);
   o.D("volume_step", SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP), 4);
   o.I("stops_level_points", SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL));
   o.I("freeze_level_points", SymbolInfoInteger(sym, SYMBOL_TRADE_FREEZE_LEVEL));
   o.S("trade_mode", mode == SYMBOL_TRADE_MODE_FULL ? "full" :
       (mode == SYMBOL_TRADE_MODE_DISABLED ? "disabled" :
        (mode == SYMBOL_TRADE_MODE_CLOSEONLY ? "close_only" :
         (mode == SYMBOL_TRADE_MODE_LONGONLY ? "long_only" : "short_only"))));
   o.B("allowed_for_api", SymbolAllowed(sym));
   o.S("currency_profit", SymbolInfoString(sym, SYMBOL_CURRENCY_PROFIT));
   o.I("last_tick_unix", (long)tk.time);
   out = o.Done();
   return true;
  }

bool CmdRates(string &out, string &err)
  {
   string sym = PStr("symbol", "");
   if(sym == "" || !SymbolSelect(sym, true))
     {
      err = "unknown symbol '" + sym + "'";
      return false;
     }
   ENUM_TIMEFRAMES tf;
   string tfs = PStr("timeframe", "M5");
   if(!ParseTf(tfs, tf))
     {
      err = "bad timeframe '" + tfs + "' (use M1,M5,M15,M30,H1,H4,D1...)";
      return false;
     }
   int count = (int)PLong("count", 200);
   if(count < 1)
      count = 1;
   if(count > InpMaxBars)
      count = InpMaxBars;
   MqlRates r[];
   ResetLastError();
   int n = CopyRates(sym, tf, 0, count, r);
   if(n <= 0)
     {
      err = StringFormat("CopyRates failed (error %d); history may still be loading, retry in a few seconds", GetLastError());
      return false;
     }
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   string bars = "[";
   for(int i = 0; i < n; i++)
     {
      if(i > 0)
         bars += ",";
      bars += "[" + IntegerToString((long)r[i].time) + "," + Num(r[i].open, dg) + "," + Num(r[i].high, dg) + "," +
              Num(r[i].low, dg) + "," + Num(r[i].close, dg) + "," + IntegerToString(r[i].tick_volume) + "]";
     }
   bars += "]";
   JObj o;
   o.S("symbol", sym);
   o.S("timeframe", tfs);
   o.I("digits", dg);
   o.S("columns", "time,open,high,low,close,tick_volume");
   o.S("note", "oldest first; time = server time as unix seconds; the last bar is still forming");
   o.R("bars", bars);
   out = o.Done();
   return true;
  }

bool CmdPositions(string &out, string &err)
  {
   string arr = "[";
   int k = 0;
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      long type = PositionGetInteger(POSITION_TYPE);
      double vol = PositionGetDouble(POSITION_VOLUME);
      double po = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      JObj o;
      o.I("ticket", (long)t);
      o.S("symbol", sym);
      o.S("type", PositionTypeName(type));
      o.D("volume", vol, 4);
      o.D("price_open", po, dg);
      o.D("price_current", PositionGetDouble(POSITION_PRICE_CURRENT), dg);
      o.D("sl", sl, dg);
      o.D("tp", PositionGetDouble(POSITION_TP), dg);
      o.D("profit", PositionGetDouble(POSITION_PROFIT), 2);
      o.D("swap", PositionGetDouble(POSITION_SWAP), 2);
      double loss = 0;
      if(sl > 0 && LossAtSL(sym, type == POSITION_TYPE_BUY, vol, po, sl, loss))
         o.D("pnl_at_sl", -loss, 2);
      else
         o.R("pnl_at_sl", "null");
      o.I("time_open_unix", PositionGetInteger(POSITION_TIME));
      o.I("magic", PositionGetInteger(POSITION_MAGIC));
      o.B("managed", IsManaged(PositionGetInteger(POSITION_MAGIC)));
      o.S("comment", PositionGetString(POSITION_COMMENT));
      if(k++ > 0)
         arr += ",";
      arr += o.Done();
     }
   arr += "]";
   JObj r;
   r.I("count", k);
   r.R("positions", arr);
   out = r.Done();
   return true;
  }

bool CmdOrders(string &out, string &err)
  {
   string arr = "[";
   int k = 0;
   for(int i = 0; i < OrdersTotal(); i++)
     {
      ulong t = OrderGetTicket(i);
      if(t == 0)
         continue;
      string sym = OrderGetString(ORDER_SYMBOL);
      int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      JObj o;
      o.I("ticket", (long)t);
      o.S("symbol", sym);
      o.S("type", OrderTypeName(OrderGetInteger(ORDER_TYPE)));
      o.D("volume", OrderGetDouble(ORDER_VOLUME_CURRENT), 4);
      o.D("price", OrderGetDouble(ORDER_PRICE_OPEN), dg);
      o.D("sl", OrderGetDouble(ORDER_SL), dg);
      o.D("tp", OrderGetDouble(ORDER_TP), dg);
      o.I("time_setup_unix", OrderGetInteger(ORDER_TIME_SETUP));
      o.I("expiration_unix", OrderGetInteger(ORDER_TIME_EXPIRATION));
      o.I("magic", OrderGetInteger(ORDER_MAGIC));
      o.B("managed", IsManaged(OrderGetInteger(ORDER_MAGIC)));
      o.S("comment", OrderGetString(ORDER_COMMENT));
      if(k++ > 0)
         arr += ",";
      arr += o.Done();
     }
   arr += "]";
   JObj r;
   r.I("count", k);
   r.R("orders", arr);
   out = r.Done();
   return true;
  }

bool CmdHistory(string &out, string &err)
  {
   int days = (int)PLong("days", 1);
   if(days < 1)
      days = 1;
   if(days > 30)
      days = 30;
   bool all = (PLong("all", 0) != 0);
   datetime from = DayStart(Now()) - (days - 1) * 86400;
   if(!HistorySelect(from, Now() + 86400))
     {
      err = "HistorySelect failed";
      return false;
     }
   string arr = "[";
   int k = 0, wins = 0, losses = 0;
   double realized = 0;
   for(int i = 0; i < HistoryDealsTotal(); i++)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0)
         continue;
      long type = HistoryDealGetInteger(d, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL)
         continue;
      bool managed = IsManaged(HistoryDealGetInteger(d, DEAL_MAGIC));
      if(!all && !managed)
         continue;
      string sym = HistoryDealGetString(d, DEAL_SYMBOL);
      int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      double net = HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_SWAP) +
                   HistoryDealGetDouble(d, DEAL_COMMISSION);
      if(managed)
        {
         realized += net;
         if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY || entry == DEAL_ENTRY_INOUT)
           {
            if(net >= 0)
               wins++;
            else
               losses++;
           }
        }
      JObj o;
      o.I("ticket", (long)d);
      o.I("order", HistoryDealGetInteger(d, DEAL_ORDER));
      o.I("position_id", HistoryDealGetInteger(d, DEAL_POSITION_ID));
      o.I("time_unix", HistoryDealGetInteger(d, DEAL_TIME));
      o.S("symbol", sym);
      o.S("type", type == DEAL_TYPE_BUY ? "buy" : "sell");
      o.S("entry", DealEntryName(entry));
      o.D("volume", HistoryDealGetDouble(d, DEAL_VOLUME), 4);
      o.D("price", HistoryDealGetDouble(d, DEAL_PRICE), dg);
      o.D("profit", HistoryDealGetDouble(d, DEAL_PROFIT), 2);
      o.D("commission", HistoryDealGetDouble(d, DEAL_COMMISSION), 2);
      o.D("swap", HistoryDealGetDouble(d, DEAL_SWAP), 2);
      o.B("managed", managed);
      o.S("comment", HistoryDealGetString(d, DEAL_COMMENT));
      if(k++ > 0)
         arr += ",";
      arr += o.Done();
     }
   arr += "]";
   JObj r;
   r.I("days", days);
   r.I("count", k);
   r.D("managed_realized_net", realized, 2);
   r.I("managed_closed_wins", wins);
   r.I("managed_closed_losses", losses);
   r.R("deals", arr);
   out = r.Done();
   return true;
  }

//+------------------------------------------------------------------+
//| Commands: trading                                                |
//+------------------------------------------------------------------+
bool CmdPlaceOrder(string &out, string &err)
  {
   string sym   = PStr("symbol", "");
   string side  = PStr("side", "");
   string otype = PStr("type", "market");
   double price = PDbl("price", 0);
   double sl    = PDbl("sl", 0);
   double tp    = PDbl("tp", 0);
   double vol   = PDbl("volume", 0);
   double riskPct = PDbl("risk_pct", 0);
   int    expMin  = (int)PLong("expiration_minutes", 0);
   string cmt   = PStr("comment", "claude");

   if(side != "buy" && side != "sell")
     {
      err = "side must be 'buy' or 'sell'";
      return false;
     }
   if(otype != "market" && otype != "limit" && otype != "stop")
     {
      err = "type must be 'market', 'limit' or 'stop'";
      return false;
     }
   bool isBuy = (side == "buy");
   if(!CheckCanOpen(err))
      return false;
   if(!CheckSymbolForEntry(sym, isBuy, err))
      return false;

   MqlTick tk;
   if(!SymbolInfoTick(sym, tk) || tk.bid <= 0 || tk.ask <= 0)
     {
      err = "no valid quote for " + sym;
      return false;
     }
   int    dg        = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double stopsDist = StopsDistance(sym);
   double entry;
   if(otype == "market")
      entry = isBuy ? tk.ask : tk.bid;
   else
     {
      if(price <= 0)
        {
         err = "price is required for limit/stop orders";
         return false;
        }
      entry = NormPrice(sym, price);
      if(otype == "limit")
        {
         if(isBuy && entry >= tk.ask)
            err = "buy limit price must be below ask " + DoubleToString(tk.ask, dg);
         if(!isBuy && entry <= tk.bid)
            err = "sell limit price must be above bid " + DoubleToString(tk.bid, dg);
        }
      else
        {
         if(isBuy && entry <= tk.ask)
            err = "buy stop price must be above ask " + DoubleToString(tk.ask, dg);
         if(!isBuy && entry >= tk.bid)
            err = "sell stop price must be below bid " + DoubleToString(tk.bid, dg);
        }
      if(err != "")
         return false;
      double ref = isBuy ? tk.ask : tk.bid;
      if(MathAbs(entry - ref) < stopsDist)
        {
         err = StringFormat("pending price too close to market (stops level %d points)",
                            (int)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL));
         return false;
        }
     }

   sl = NormPrice(sym, sl);
   tp = NormPrice(sym, tp);
   if(InpRequireSL && sl <= 0)
     {
      err = "stop loss (sl) is required";
      return false;
     }
   if(sl > 0)
     {
      if(isBuy && sl >= entry)
        {
         err = "for a buy, sl must be below entry " + DoubleToString(entry, dg);
         return false;
        }
      if(!isBuy && sl <= entry)
        {
         err = "for a sell, sl must be above entry " + DoubleToString(entry, dg);
         return false;
        }
      if(MathAbs(entry - sl) < stopsDist)
        {
         err = StringFormat("sl too close to entry (stops level %d points)", (int)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL));
         return false;
        }
     }
   if(tp > 0)
     {
      if(isBuy && tp <= entry)
        {
         err = "for a buy, tp must be above entry";
         return false;
        }
      if(!isBuy && tp >= entry)
        {
         err = "for a sell, tp must be below entry";
         return false;
        }
      if(MathAbs(tp - entry) < stopsDist)
        {
         err = "tp too close to entry (stops level)";
         return false;
        }
     }

   double equity       = AccountInfoDouble(ACCOUNT_EQUITY);
   double maxRiskMoney = equity * InpMaxRiskPct / 100.0;
   double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);

   if(riskPct > 0)
     {
      if(riskPct > InpMaxRiskPct + 1e-9)
        {
         err = StringFormat("risk_pct %.2f exceeds max %.2f", riskPct, InpMaxRiskPct);
         return false;
        }
      if(sl <= 0)
        {
         err = "risk_pct requires sl";
         return false;
        }
      double loss1 = 0;
      if(!LossAtSL(sym, isBuy, 1.0, entry, sl, loss1) || loss1 <= 0)
        {
         err = "cannot compute risk for " + sym;
         return false;
        }
      vol = MathMin((equity * riskPct / 100.0) / loss1, InpMaxLot);
     }
   if(vol <= 0)
     {
      err = "either volume or risk_pct is required";
      return false;
     }
   vol = NormVolume(sym, vol);
   if(vol < vmin - 1e-9)
     {
      err = StringFormat("volume %.4f below symbol minimum %.4f (risk too small for this SL distance)", vol, vmin);
      return false;
     }
   if(vol > vmax + 1e-9)
     {
      err = StringFormat("volume %.4f above symbol maximum %.4f", vol, vmax);
      return false;
     }
   if(vol > InpMaxLot + 1e-9)
     {
      err = StringFormat("volume %.4f exceeds max lot %.4f", vol, InpMaxLot);
      return false;
     }

   double riskMoney = 0;
   if(sl > 0)
     {
      if(!LossAtSL(sym, isBuy, vol, entry, sl, riskMoney))
        {
         err = "cannot compute risk for " + sym;
         return false;
        }
      if(riskMoney > maxRiskMoney + 0.005)
        {
         err = StringFormat("risk %.2f %s (%.2f%% of equity) exceeds max %.2f%%; reduce volume or tighten sl",
                            riskMoney, AccountInfoString(ACCOUNT_CURRENCY), riskMoney / equity * 100.0, InpMaxRiskPct);
         return false;
        }
     }

   double margin = 0;
   if(!OrderCalcMargin(isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, sym, vol, entry, margin))
     {
      err = "cannot compute margin for " + sym;
      return false;
     }
   if(margin > AccountInfoDouble(ACCOUNT_MARGIN_FREE))
     {
      err = StringFormat("not enough free margin: need %.2f, free %.2f", margin, AccountInfoDouble(ACCOUNT_MARGIN_FREE));
      return false;
     }

   if(StringLen(cmt) > 31)
      cmt = StringSubstr(cmt, 0, 31);
   g_trade.SetTypeFillingBySymbol(sym);
   ENUM_ORDER_TYPE_TIME tt = ORDER_TIME_GTC;
   datetime exp = 0;
   if(otype != "market" && expMin > 0)
     {
      tt = ORDER_TIME_SPECIFIED;
      exp = Now() + expMin * 60;
     }

   bool sent = false;
   if(otype == "market")
      sent = isBuy ? g_trade.Buy(vol, sym, 0.0, sl, tp, cmt) : g_trade.Sell(vol, sym, 0.0, sl, tp, cmt);
   else
      if(otype == "limit")
         sent = isBuy ? g_trade.BuyLimit(vol, entry, sym, sl, tp, tt, exp, cmt) : g_trade.SellLimit(vol, entry, sym, sl, tp, tt, exp, cmt);
      else
         sent = isBuy ? g_trade.BuyStop(vol, entry, sym, sl, tp, tt, exp, cmt) : g_trade.SellStop(vol, entry, sym, sl, tp, tt, exp, cmt);

   if(!sent || !RetcodeOk(g_trade.ResultRetcode()))
     {
      err = TradeError("order");
      return false;
     }
   g_lastTradeTime = Now();

   JObj o;
   o.I("retcode", g_trade.ResultRetcode());
   o.S("retcode_desc", g_trade.ResultRetcodeDescription());
   o.I("order", (long)g_trade.ResultOrder());
   o.I("deal", (long)g_trade.ResultDeal());
   o.S("symbol", sym);
   o.S("side", side);
   o.S("type", otype);
   o.D("volume", vol, 4);
   o.D("price", otype == "market" ? g_trade.ResultPrice() : entry, dg);
   o.D("sl", sl, dg);
   o.D("tp", tp, dg);
   o.D("risk_money", riskMoney, 2);
   o.D("risk_pct", equity > 0 ? riskMoney / equity * 100.0 : 0.0, 3);
   out = o.Done();
   return true;
  }

bool CmdModifyPosition(string &out, string &err)
  {
   if(!CheckCanModify(err))
      return false;
   ulong ticket = (ulong)PLong("ticket", 0);
   if(ticket == 0 || !PositionSelectByTicket(ticket))
     {
      err = "position not found";
      return false;
     }
   if(!IsManaged(PositionGetInteger(POSITION_MAGIC)))
     {
      err = "position is not managed by this EA (magic mismatch)";
      return false;
     }
   string sym   = PositionGetString(POSITION_SYMBOL);
   bool   isBuy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
   double curSL = PositionGetDouble(POSITION_SL);
   double curTP = PositionGetDouble(POSITION_TP);
   double po    = PositionGetDouble(POSITION_PRICE_OPEN);
   double vol   = PositionGetDouble(POSITION_VOLUME);
   int    dg    = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double newSL = Has("sl") ? NormPrice(sym, PDbl("sl", 0)) : curSL;
   double newTP = Has("tp") ? NormPrice(sym, PDbl("tp", 0)) : curTP;

   if(InpRequireSL && newSL <= 0)
     {
      err = "sl cannot be removed (require_sl)";
      return false;
     }
   bool loosening = (curSL <= 0) || (isBuy ? (newSL < curSL - 1e-10) : (newSL > curSL + 1e-10));
   if(newSL > 0 && curSL > 0 && loosening && InpOnlyTightenSL)
     {
      err = StringFormat("sl may only be moved in favour of the position (current %s)", DoubleToString(curSL, dg));
      return false;
     }
   MqlTick tk;
   if(!SymbolInfoTick(sym, tk))
     {
      err = "no quote for " + sym;
      return false;
     }
   double stopsDist = StopsDistance(sym);
   if(newSL > 0)
     {
      if(isBuy && newSL > tk.bid - stopsDist)
        {
         err = "for a buy, sl must be below bid " + DoubleToString(tk.bid, dg) + " by at least the stops level";
         return false;
        }
      if(!isBuy && newSL < tk.ask + stopsDist)
        {
         err = "for a sell, sl must be above ask " + DoubleToString(tk.ask, dg) + " by at least the stops level";
         return false;
        }
      if(loosening)
        {
         double loss = 0;
         double maxRiskMoney = AccountInfoDouble(ACCOUNT_EQUITY) * InpMaxRiskPct / 100.0;
         if(LossAtSL(sym, isBuy, vol, po, newSL, loss) && loss > maxRiskMoney + 0.005)
           {
            err = StringFormat("new sl risks %.2f, above max %.2f%% of equity", loss, InpMaxRiskPct);
            return false;
           }
        }
     }
   if(newTP > 0)
     {
      if(isBuy && newTP < tk.bid + stopsDist)
        {
         err = "for a buy, tp must be above bid by at least the stops level";
         return false;
        }
      if(!isBuy && newTP > tk.ask - stopsDist)
        {
         err = "for a sell, tp must be below ask by at least the stops level";
         return false;
        }
     }
   if(MathAbs(newSL - curSL) < 1e-10 && MathAbs(newTP - curTP) < 1e-10)
     {
      JObj n;
      n.B("changed", false);
      n.D("sl", curSL, dg);
      n.D("tp", curTP, dg);
      out = n.Done();
      return true;
     }
   if(!g_trade.PositionModify(ticket, newSL, newTP) || !RetcodeOk(g_trade.ResultRetcode()))
     {
      err = TradeError("modify");
      return false;
     }
   JObj o;
   o.B("changed", true);
   o.I("ticket", (long)ticket);
   o.D("sl", newSL, dg);
   o.D("tp", newTP, dg);
   out = o.Done();
   return true;
  }

bool CmdClosePosition(string &out, string &err)
  {
   if(!CheckCanModify(err))
      return false;
   ulong ticket = (ulong)PLong("ticket", 0);
   if(ticket == 0 || !PositionSelectByTicket(ticket))
     {
      err = "position not found";
      return false;
     }
   if(!IsManaged(PositionGetInteger(POSITION_MAGIC)))
     {
      err = "position is not managed by this EA (magic mismatch)";
      return false;
     }
   string sym  = PositionGetString(POSITION_SYMBOL);
   double pvol = PositionGetDouble(POSITION_VOLUME);
   double v    = PDbl("volume", 0);
   bool   sent;
   if(v > 0 && v < pvol - 1e-9)
     {
      v = NormVolume(sym, v);
      if(v < SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN) - 1e-9)
        {
         err = "partial volume below symbol minimum";
         return false;
        }
      sent = g_trade.PositionClosePartial(ticket, v);
     }
   else
     {
      v = pvol;
      sent = g_trade.PositionClose(ticket);
     }
   if(!sent || !RetcodeOk(g_trade.ResultRetcode()))
     {
      err = TradeError("close");
      return false;
     }
   JObj o;
   o.I("ticket", (long)ticket);
   o.D("closed_volume", v, 4);
   o.D("price", g_trade.ResultPrice(), (int)SymbolInfoInteger(sym, SYMBOL_DIGITS));
   o.I("deal", (long)g_trade.ResultDeal());
   out = o.Done();
   return true;
  }

bool CmdCloseAll(string &out, string &err)
  {
   if(!CheckCanModify(err))
      return false;
   int c, d, f;
   CloseAllManaged(PStr("symbol", ""), c, d, f);
   JObj o;
   o.I("closed_positions", c);
   o.I("deleted_orders", d);
   o.I("failed", f);
   out = o.Done();
   if(f > 0)
     {
      err = StringFormat("closed %d, deleted %d, FAILED %d (see Experts log)", c, d, f);
      return false;
     }
   return true;
  }

bool CmdCancelOrder(string &out, string &err)
  {
   if(!CheckCanModify(err))
      return false;
   ulong ticket = (ulong)PLong("ticket", 0);
   if(ticket == 0 || !OrderSelect(ticket))
     {
      err = "pending order not found";
      return false;
     }
   if(!IsManaged(OrderGetInteger(ORDER_MAGIC)))
     {
      err = "order is not managed by this EA (magic mismatch)";
      return false;
     }
   if(!g_trade.OrderDelete(ticket) || !RetcodeOk(g_trade.ResultRetcode()))
     {
      err = TradeError("cancel");
      return false;
     }
   JObj o;
   o.I("ticket", (long)ticket);
   o.B("cancelled", true);
   out = o.Done();
   return true;
  }

// The API may only STOP trading. Re-enabling is reserved for the human (chart button).
bool CmdPause(string &out, string &err)
  {
   SetEnabled(false, "paused via API: " + PStr("reason", "-"));
   JObj o;
   o.B("trading_enabled", false);
   out = o.Done();
   return true;
  }

//+------------------------------------------------------------------+
//| Dispatcher                                                       |
//+------------------------------------------------------------------+
string HandleRequest(const string line)
  {
   ParseRequest(line);
   long   id  = PLong("id", 0);
   string cmd = PStr("cmd", "");
   string out = "", err = "";
   bool   ok  = false;

   if(cmd == "ping")                 ok = CmdPing(out, err);
   else if(cmd == "account")         ok = CmdAccount(out, err);
   else if(cmd == "guard")           ok = CmdGuard(out, err);
   else if(cmd == "symbol")          ok = CmdSymbol(out, err);
   else if(cmd == "rates")           ok = CmdRates(out, err);
   else if(cmd == "positions")       ok = CmdPositions(out, err);
   else if(cmd == "orders")          ok = CmdOrders(out, err);
   else if(cmd == "history")         ok = CmdHistory(out, err);
   else if(cmd == "place_order")     ok = CmdPlaceOrder(out, err);
   else if(cmd == "modify_position") ok = CmdModifyPosition(out, err);
   else if(cmd == "close_position")  ok = CmdClosePosition(out, err);
   else if(cmd == "close_all")       ok = CmdCloseAll(out, err);
   else if(cmd == "cancel_order")    ok = CmdCancelOrder(out, err);
   else if(cmd == "pause")           ok = CmdPause(out, err);
   else                              err = "unknown command '" + cmd + "'";

   bool isTrade = (cmd == "place_order" || cmd == "modify_position" || cmd == "close_position" ||
                   cmd == "close_all" || cmd == "cancel_order" || cmd == "pause");
   if(isTrade)
      PrintFormat("ClaudeGateway API %s [%s] -> %s", cmd, PStr("reason", "-"), ok ? out : ("ERROR: " + err));

   if(ok)
      return "{\"id\":" + IntegerToString(id) + ",\"ok\":true,\"result\":" + out + "}";
   return "{\"id\":" + IntegerToString(id) + ",\"ok\":false,\"error\":" + Quote(err) + "}";
  }

//+------------------------------------------------------------------+
//| Socket                                                           |
//+------------------------------------------------------------------+
void CloseSocket()
  {
   if(g_sock != INVALID_HANDLE)
     {
      SocketClose(g_sock);
      g_sock = INVALID_HANDLE;
      Print("ClaudeGateway: disconnected from bridge");
     }
   g_rx = "";
  }

bool SendLine(const string s)
  {
   if(g_sock == INVALID_HANDLE)
      return false;
   uchar data[];
   int len = StringToCharArray(s + "\n", data, 0, WHOLE_ARRAY, CP_UTF8) - 1; // drop trailing 0
   int off = 0;
   while(off < len)
     {
      uchar chunk[];
      ArrayCopy(chunk, data, 0, off, len - off);
      int sent = SocketSend(g_sock, chunk, (uint)(len - off));
      if(sent <= 0)
        {
         PrintFormat("ClaudeGateway: SocketSend failed, error %d", GetLastError());
         CloseSocket();
         return false;
        }
      off += sent;
     }
   return true;
  }

bool EnsureConnected()
  {
   if(g_sock != INVALID_HANDLE)
     {
      if(SocketIsConnected(g_sock))
         return true;
      CloseSocket();
     }
   if(TimeLocal() - g_lastConnTry < InpReconnectSec)
      return false;
   g_lastConnTry = TimeLocal();

   int s = SocketCreate();
   if(s == INVALID_HANDLE)
     {
      PrintFormat("ClaudeGateway: SocketCreate failed, error %d", GetLastError());
      return false;
     }
   ResetLastError();
   if(!SocketConnect(s, InpHost, InpPort, 500))
     {
      int e = GetLastError();
      SocketClose(s);
      if(e == 4014)
         PrintFormat("ClaudeGateway: add '%s' to Tools > Options > Expert Advisors > Allow WebRequest for listed URL", InpHost);
      return false;
     }
   g_sock = s;
   g_rx = "";
   PrintFormat("ClaudeGateway: connected to bridge %s:%d", InpHost, InpPort);
   JObj o;
   o.S("event", "hello");
   o.S("version", CG_VERSION);
   o.I("login", AccountInfoInteger(ACCOUNT_LOGIN));
   o.I("magic", (long)InpMagic);
   SendLine(o.Done());
   return true;
  }

void PollSocket()
  {
   if(!EnsureConnected())
      return;
   uint avail = SocketIsReadable(g_sock);
   if(avail == 0)
      return;
   uchar buf[];
   int got = SocketRead(g_sock, buf, avail, 100);
   if(got <= 0)
     {
      CloseSocket();
      return;
     }
   g_rx += CharArrayToString(buf, 0, got, CP_UTF8);
   while(g_sock != INVALID_HANDLE)
     {
      int pos = StringFind(g_rx, "\n");
      if(pos < 0)
         break;
      string line = StringSubstr(g_rx, 0, pos);
      g_rx = StringSubstr(g_rx, pos + 1);
      StringTrimRight(line);
      if(StringLen(line) > 0)
         SendLine(HandleRequest(line));
     }
   if(StringLen(g_rx) > 1000000)
     {
      Print("ClaudeGateway: receive buffer overflow, dropping connection");
      CloseSocket();
     }
  }

//+------------------------------------------------------------------+
//| Housekeeping: daily loss & end-of-day flatten, status display    |
//+------------------------------------------------------------------+
void Housekeeping()
  {
   datetime now = Now();
   if(now == g_lastHousekeep)
      return;
   g_lastHousekeep = now;

   bool locked  = DailyLossLocked();
   bool flatten = PastFlatten() || (locked && InpCloseOnDailyLoss);
   if(flatten && (ManagedPositions() + ManagedOrders()) > 0 && TimeLocal() - g_lastFlatTry >= 30)
     {
      g_lastFlatTry = TimeLocal();
      int c, d, f;
      CloseAllManaged("", c, d, f);
      PrintFormat("ClaudeGateway: auto-flatten (%s): closed %d, deleted %d, failed %d",
                  locked ? "daily loss limit" : "end of day", c, d, f);
     }

   double dse = DayStartEquity();
   double pnl = DailyPnl();
   Comment(StringFormat("ClaudeGateway %s   magic %I64u\nBridge: %s\nAPI trading: %s%s\nDaily P/L: %.2f (%.2f%%), limit -%.2f%%%s\nTrades today: %d/%d   Open: %d/%d\nWindow %02d:00-%02d:00, flatten %s   server %s",
                        CG_VERSION, InpMagic,
                        g_sock != INVALID_HANDLE ? "CONNECTED" : "waiting for bridge...",
                        g_enabled ? "ON" : "OFF", InpReadOnly ? " (read-only)" : "",
                        pnl, dse > 0 ? pnl / dse * 100.0 : 0.0, InpMaxDailyLossPct, locked ? "  LOCKED" : "",
                        TradesToday(), InpMaxTradesPerDay, ManagedPositions() + ManagedOrders(), InpMaxOpenPositions,
                        InpStartHour, InpEndHour,
                        InpFlattenHour < 0 ? "off" : StringFormat("%02d:%02d", InpFlattenHour, InpFlattenMinute),
                        TimeToString(now, TIME_MINUTES | TIME_SECONDS)));
  }

//+------------------------------------------------------------------+
//| Event handlers                                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints(InpDeviationPoints);
   g_trade.SetAsyncMode(false);
   g_trade.LogLevel(LOG_LEVEL_ERRORS);
   ParseSymbols();

   string gv = GvPrefix() + "enabled";
   g_enabled = InpStartEnabled && (!GlobalVariableCheck(gv) || GlobalVariableGet(gv) != 0.0);
   DayStartEquity();

   MakeButton(BTN_TOGGLE, 10, 120, 260, 26);
   MakeButton(BTN_FLAT, 10, 150, 260, 26);
   UpdateButtons();

   EventSetMillisecondTimer(100);
   PrintFormat("ClaudeGateway %s started: bridge %s:%d, magic %I64u, trading %s", CG_VERSION, InpHost, InpPort,
               InpMagic, g_enabled ? "ON" : "OFF");
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   CloseSocket();
   ObjectDelete(0, BTN_TOGGLE);
   ObjectDelete(0, BTN_FLAT);
   Comment("");
  }

void OnTimer()
  {
   PollSocket();
   Housekeeping();
  }

void OnTick()
  {
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(id != CHARTEVENT_OBJECT_CLICK)
      return;
   if(sparam == BTN_TOGGLE)
     {
      SetEnabled(!g_enabled, "chart button");
      ObjectSetInteger(0, BTN_TOGGLE, OBJPROP_STATE, false);
     }
   else
      if(sparam == BTN_FLAT)
        {
         SetEnabled(false, "close-all button");
         int c, d, f;
         CloseAllManaged("", c, d, f);
         PrintFormat("ClaudeGateway: manual close-all: closed %d, deleted %d, failed %d", c, d, f);
         ObjectSetInteger(0, BTN_FLAT, OBJPROP_STATE, false);
        }
   ChartRedraw();
  }
//+------------------------------------------------------------------+

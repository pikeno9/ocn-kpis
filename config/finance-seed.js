// Seed do Finance extraído do Excel "(09.06.26) BR - P&L projection.xlsx".
// HC por cargo (salário/VR/saúde/encargos%/bônus + headcount mensal), SG&A (Rent/Prof/IT
// com itens de detalhe × 12 meses) e CAC (comissão por carro, Ads, influenciadores).
module.exports = {
 "HC": {
  "roles": [
   {
    "id": "x0",
    "name": "Sales Consultant I (contractor)",
    "salary": 540,
    "meal": 0,
    "health": 0,
    "taxPct": 0,
    "bonus": 0
   },
   {
    "id": "x1",
    "name": "Sales Consultant I",
    "salary": 540,
    "meal": 220,
    "health": 157.75,
    "taxPct": 35.8,
    "bonus": 0
   },
   {
    "id": "x2",
    "name": "Sales Manager",
    "salary": 2200,
    "meal": 220,
    "health": 291.01,
    "taxPct": 35.8,
    "bonus": 0
   },
   {
    "id": "x3",
    "name": "PMO Lead",
    "salary": 8800,
    "meal": 220,
    "health": 485,
    "taxPct": 0,
    "bonus": 8800
   },
   {
    "id": "x4",
    "name": "Strategy & Business Performance Lead",
    "salary": 8000,
    "meal": 220,
    "health": 485,
    "taxPct": 0,
    "bonus": 8000
   },
   {
    "id": "x5",
    "name": "Customer Support Manager",
    "salary": 4500,
    "meal": 220,
    "health": 0,
    "taxPct": 35.8,
    "bonus": 0
   },
   {
    "id": "x6",
    "name": "Marketing Lead",
    "salary": 4200,
    "meal": 220,
    "health": 663.48,
    "taxPct": 0,
    "bonus": 4200
   },
   {
    "id": "x7",
    "name": "Office Manager",
    "salary": 3600,
    "meal": 220,
    "health": 683.38,
    "taxPct": 35.8,
    "bonus": 0
   },
   {
    "id": "x8",
    "name": "Fleet Manager (Fleet Delivery)",
    "salary": 3600,
    "meal": 220,
    "health": 1272.09,
    "taxPct": 35.8,
    "bonus": 0
   },
   {
    "id": "x9",
    "name": "Collections Manager",
    "salary": 2400,
    "meal": 220,
    "health": 751.87,
    "taxPct": 36,
    "bonus": 0
   },
   {
    "id": "x10",
    "name": "Operations Manager (Control Tower, Claims & Repairs and Recovery)",
    "salary": 3900,
    "meal": 220,
    "health": 291.01,
    "taxPct": 36,
    "bonus": 3900
   },
   {
    "id": "x11",
    "name": "Operations Analyst (Fleet Management)",
    "salary": 1500,
    "meal": 220,
    "health": 107.46,
    "taxPct": 36,
    "bonus": 0
   },
   {
    "id": "x12",
    "name": "Collections Analyst",
    "salary": 540,
    "meal": 220,
    "health": 0,
    "taxPct": 36,
    "bonus": 0
   },
   {
    "id": "x13",
    "name": "Claims & Repairs Analyst",
    "salary": 540,
    "meal": 220,
    "health": 0,
    "taxPct": 36,
    "bonus": 0
   },
   {
    "id": "x14",
    "name": "Marketing Analyst",
    "salary": 800,
    "meal": 220,
    "health": 0,
    "taxPct": 36,
    "bonus": 0
   },
   {
    "id": "x15",
    "name": "Customer Support Analyst I",
    "salary": 540,
    "meal": 220,
    "health": 0,
    "taxPct": 36,
    "bonus": 0
   },
   {
    "id": "x16",
    "name": "Customer Support Analyst II",
    "salary": 700,
    "meal": 220,
    "health": 107.46,
    "taxPct": 36,
    "bonus": 0
   },
   {
    "id": "x17",
    "name": "Onboarding Assistant",
    "salary": 800,
    "meal": 220,
    "health": 0,
    "taxPct": 36,
    "bonus": 0
   },
   {
    "id": "x18",
    "name": "Finance / Admin. Analyst",
    "salary": 800,
    "meal": 220,
    "health": 0,
    "taxPct": 36,
    "bonus": 0
   },
   {
    "id": "x19",
    "name": "Fleet Delivery Receptionist",
    "salary": 800,
    "meal": 220,
    "health": 0,
    "taxPct": 36,
    "bonus": 0
   },
   {
    "id": "x20",
    "name": "Patio Assistant",
    "salary": 800,
    "meal": 220,
    "health": 0,
    "taxPct": 36,
    "bonus": 0
   }
  ],
  "plan": {
   "x0": [
    0,
    0,
    0,
    1,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    0
   ],
   "x1": [
    0,
    0,
    0,
    1,
    4,
    4,
    4,
    4,
    4,
    4,
    4,
    4
   ],
   "x2": [
    0,
    0,
    0,
    0,
    0,
    0.5,
    1,
    1,
    1,
    1,
    1,
    1
   ],
   "x3": [
    0,
    0.5,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1
   ],
   "x4": [
    0,
    0,
    0.5,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1
   ],
   "x5": [
    0,
    0,
    0.5,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0
   ],
   "x6": [
    0,
    0.5,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1
   ],
   "x7": [
    0,
    0,
    0.5,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1
   ],
   "x8": [
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1
   ],
   "x9": [
    0,
    0,
    0,
    0.5,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1
   ],
   "x10": [
    0,
    0,
    0,
    0,
    0.5,
    1,
    1,
    1,
    1,
    1,
    1,
    1
   ],
   "x11": [
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1
   ],
   "x12": [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0
   ],
   "x13": [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0
   ],
   "x14": [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0
   ],
   "x15": [
    0,
    0,
    0,
    2,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0
   ],
   "x16": [
    0,
    0,
    0,
    0,
    0.5,
    1,
    1,
    1,
    1,
    1,
    1,
    1
   ],
   "x17": [
    0,
    0,
    0,
    0.5,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1
   ],
   "x18": [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0
   ],
   "x19": [
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0
   ],
   "x20": [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0
   ]
  }
 },
 "SGA": {
  "rent": [
   {
    "label": "Office rental",
    "v": [
     0,
     1000,
     1000,
     1000,
     1000,
     1000,
     1000,
     1000,
     1000,
     1000,
     1000,
     1000
    ]
   },
   {
    "label": "Common area fees and property taxes (IPTU)",
    "v": [
     0,
     692,
     692,
     692,
     692,
     692,
     692,
     692,
     692,
     692,
     692,
     692
    ]
   },
   {
    "label": "General bills (electricity, internet, water, F&B, stationery, etc.)",
    "v": [
     0,
     30,
     300,
     300,
     300,
     300,
     300,
     300,
     300,
     300,
     300,
     300
    ]
   },
   {
    "label": "Office cleaning",
    "v": [
     0,
     0,
     200,
     200,
     1020,
     1020,
     1020,
     1020,
     1020,
     1020,
     1020,
     1020
    ]
   },
   {
    "label": "Office maintenance",
    "v": [
     0,
     400,
     400,
     200,
     200,
     200,
     200,
     200,
     200,
     200,
     200,
     200
    ]
   },
   {
    "label": "Virtual office in Curitiba city",
    "v": [
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     22,
     22,
     22,
     22,
     22
    ]
   },
   {
    "label": "Yard maintenance",
    "v": [
     0,
     0,
     320,
     320,
     320,
     320,
     320,
     320,
     320,
     320,
     320,
     320
    ]
   },
   {
    "label": "Leadership car parking",
    "v": [
     0,
     0,
     120,
     180,
     180,
     240,
     240,
     240,
     240,
     240,
     240,
     240
    ]
   },
   {
    "label": "Furniture acquisition (desks, television, microwave, freezer, etc.)",
    "v": [
     0,
     2000,
     2000,
     2000,
     6000,
     1000,
     1000,
     1000,
     1000,
     1000,
     1000,
     1000
    ]
   },
   {
    "label": "Office chairs",
    "v": [
     0,
     0,
     5600,
     3500,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0
    ]
   },
   {
    "label": "Furniture installation",
    "v": [
     0,
     0,
     200,
     300,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0
    ]
   },
   {
    "label": "Furniture maintenance",
    "v": [
     0,
     0,
     0,
     600,
     0,
     0,
     1400,
     0,
     0,
     1700,
     0,
     0
    ]
   },
   {
    "label": "Fleet Delivery team uniform",
    "v": [
     0,
     0,
     360,
     180,
     180,
     0,
     0,
     0,
     360,
     0,
     0,
     0
    ]
   }
  ],
  "prof": [
   {
    "label": "Accounting & Tax Services (Nelson)",
    "v": [
     0,
     0,
     580,
     780,
     1020,
     1020,
     1020,
     1240,
     1240,
     1240,
     1240,
     1240
    ]
   },
   {
    "label": "Legal Counsel (Pinheiro Neto)",
    "v": [
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0
    ]
   },
   {
    "label": "Defleet BI platform (Auto-Avaliar)",
    "v": [
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     500,
     500,
     500
    ]
   }
  ],
  "it": [
   {
    "label": "Laptop purchase",
    "v": [
     0,
     1100,
     2750,
     8800,
     6050,
     2500,
     0,
     0,
     0,
     0,
     0,
     0
    ]
   },
   {
    "label": "Softwares (Google Suit, Office 365, Claude, etc.)",
    "v": [
     0,
     200,
     500,
     1600,
     1100,
     400,
     120,
     120,
     120,
     120,
     120,
     120
    ]
   }
  ]
 },
 "CAC": {
  "perUnit": 20,
  "ads": [
   {
    "label": "Google Ads",
    "v": [
     0,
     0,
     0,
     200,
     0,
     500,
     500,
     500,
     500,
     500,
     500,
     500
    ]
   },
   {
    "label": "Meta Ads",
    "v": [
     0,
     0,
     0,
     200,
     0,
     500,
     500,
     500,
     500,
     500,
     500,
     500
    ]
   }
  ],
  "inf": [
   {
    "label": "Small Influencers",
    "price": 500,
    "profiles": [
     0,
     0,
     0,
     2,
     2,
     2,
     2,
     2,
     2,
     2,
     2,
     2
    ]
   },
   {
    "label": "Medium Influencers",
    "price": 1000,
    "profiles": [
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0
    ]
   },
   {
    "label": "Big Influencers",
    "price": 3000,
    "profiles": [
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0,
     0
    ]
   }
  ]
 }
};

(function () {
  const rarities = {
    N: {
      code: 'N',
      label: '普通',
      rate: 62,
      color: '#8b6a43',
      glow: 'rgba(139, 106, 67, 0.28)'
    },
    R: {
      code: 'R',
      label: '稀有',
      rate: 25,
      color: '#4f7a8c',
      glow: 'rgba(79, 122, 140, 0.28)'
    },
    SR: {
      code: 'SR',
      label: '超稀有',
      rate: 10,
      color: '#7a4f8c',
      glow: 'rgba(122, 79, 140, 0.3)'
    },
    SSR: {
      code: 'SSR',
      label: '傳說',
      rate: 3,
      color: '#b9872f',
      glow: 'rgba(185, 135, 47, 0.32)'
    }
  };

  const rarityOrder = ['N', 'R', 'SR', 'SSR'];

  const mascots = [
    {
      id: 'mascot-001',
      name: '招福小狐',
      rarity: 'N',
      title: '把今天的好運叼回來',
      description: '總是搖著尾巴出現，專門幫你把散落的小幸運一個個撿回來。',
      image: './images/mascots/mascot.jpg',
      silhouette: './images/mascots/mascot-shadow.png',
      points: 40,
      tickets: 0,
      duplicateBonus: 20
    },
    {
      id: 'mascot-002',
      name: '糯米麻糬貓',
      rarity: 'N',
      title: '軟呼呼的好運陪伴',
      description: '像麻糬一樣軟綿綿，據說摸摸牠就能讓今天的心情變得圓滾滾。',
      image: './images/mascots/mascot.jpg',
      silhouette: './images/mascots/mascot-shadow.png',
      points: 50,
      tickets: 0,
      duplicateBonus: 20
    },
    {
      id: 'mascot-003',
      name: '轉運小企鵝',
      rarity: 'N',
      title: '滑進你生活裡的小福氣',
      description: '走路總是搖搖晃晃，但每一步都像把低潮悄悄推走一點點。',
      image: './images/mascots/mascot.jpg',
      silhouette: './images/mascots/mascot-shadow.png',
      points: 55,
      tickets: 0,
      duplicateBonus: 20
    },
    {
      id: 'mascot-004',
      name: '暖陽小熊',
      rarity: 'N',
      title: '把陰天曬成好天氣',
      description: '肚子上藏著小太陽，總能在你需要的時候送來剛剛好的暖意。',
      image: './images/mascots/mascot.jpg',
      silhouette: './images/mascots/mascot-.png',
      points: 60,
      tickets: 0,
      duplicateBonus: 20
    },

    {
      id: 'mascot-005',
      name: '錦鯉小鶴',
      rarity: 'R',
      title: '替願望帶路的小信使',
      description: '飛過水面時會捲起細細金光，據說看見牠的人願望比較容易有回音。',
      image: './images/mascots/mascot-crane.jpg',
      silhouette: './images/mascots/mascot-shadow.png',
      points: 90,
      tickets: 1,
      duplicateBonus: 40
    },
    {
      id: 'mascot-006',
      name: '琥珀小鹿',
      rarity: 'R',
      title: '在林間撿回好運的角',
      description: '有著像琥珀一樣透亮的角，會把走散的機會重新引回你身邊。',
      image: './images/mascots/mascot.jpg',
      silhouette: './images/mascots/mascot-shadow.png',
      points: 100,
      tickets: 1,
      duplicateBonus: 40
    },
    {
      id: 'mascot-007',
      name: '月芽小兔',
      rarity: 'R',
      title: '替夜晚添上一點溫柔幸運',
      description: '耳尖掛著小月光，最擅長在安靜的時候把好消息送進心裡。',
      image: './images/mascots/mascot.jpg',
      silhouette: './images/mascots/mascot-shadow.png',
      points: 120,
      tickets: 1,
      duplicateBonus: 40
    },

    {
      id: 'mascot-008',
      name: '星砂海豹',
      rarity: 'SR',
      title: '會翻滾出星光的福氣守護者',
      description: '每次拍手都像撒出一圈細亮星砂，讓周圍的氣氛一下變得閃閃發亮。',
      image: './images/mascots/mascot.jpg',
      silhouette: './images/mascots/mascot-shadow.png',
      points: 180,
      tickets: 1,
      duplicateBonus: 80
    },
    {
      id: 'mascot-009',
      name: '金鈴小龍',
      rarity: 'SR',
      title: '把福氣搖進今天的空氣裡',
      description: '尾巴繫著一顆小金鈴，晃動時會把沉悶的日子搖出一點驚喜。',
      image: './images/mascots/mascot.jpg',
      silhouette: './images/mascots/mascot-shadow.png',
      points: 220,
      tickets: 2,
      duplicateBonus: 80
    },

    {
      id: 'mascot-010',
      name: '福願白凰',
      rarity: 'SSR',
      title: '傳說中為願望點燈的吉祥物',
      description: '只有在特別好的日子才會現身，羽翼展開時像把整片夜空都點亮了。',
      image: './images/mascots/mascot.jpg',
      silhouette: './images/mascots/mascot-shadow.png',
      points: 420,
      tickets: 3,
      duplicateBonus: 150
    }
  ];

  const defaults = {
    coins: 10,
    points: 0,
    tickets: 0,
    collection: [],
    recentDraws: []
  };
  function getRarityConfig(rarityCode) {
return rarities[rarityCode] || rarities.N;
  }

  function getMascotById(mascotId) {
    return mascots.find((item) => item.id === mascotId) || null;
  }

  function getMascotsByRarity(rarityCode) {
    return mascots.filter((item) => item.rarity === rarityCode);
  }

  window.GachaData = {
    gameName: '好運蛋扭扭樂',
    rarityOrder,
    rarities,
    mascots,
    defaults,
    getRarityConfig,
    getMascotById,
    getMascotsByRarity
  };
})();
